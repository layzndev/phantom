import net from "node:net";
import { randomUUID } from "node:crypto";
import type { ProxyConfig } from "./config.js";
import type { GuardTelemetryClient, GuardDecision, GuardAction } from "./guard-telemetry.js";
import { log } from "./logger.js";
import { metrics } from "./metrics.js";
import { normalizeHostname, isValidHostnameShape } from "./hostname.js";
import {
  encodeLoginDisconnect,
  encodeStatusPong,
  encodeStatusResponse,
  readNextPacket,
  tryParseHandshake,
  tryParseLoginStart,
  type MinecraftHandshake
} from "./protocol.js";
import { buildProxyV2Header, tryParseProxyProtocolHeader } from "./proxy-protocol.js";
import type { PhantomRoutingClient, RoutingRecord, RoutingStatus } from "./routing.js";

interface HandlerDeps {
  config: ProxyConfig;
  routing: PhantomRoutingClient;
  guardTelemetry: GuardTelemetryClient;
}

const MOTD_UNKNOWN = "Unknown Phantom server";
const MOTD_WAKING = "Starting server...";
const MOTD_SLEEPING = "Server is sleeping. Connect to wake it.";
const MOTD_MAINTENANCE = "Server unavailable";
const MOTD_RESTARTING = "Restarting server...";

const DISCONNECT_UNKNOWN = "Unknown Phantom server.";
const DISCONNECT_WAKING = "Server is starting, retry in a few seconds.";
const DISCONNECT_RESTARTING = "Server is restarting, try again shortly.";
const DISCONNECT_MAINTENANCE = "Server temporarily unavailable.";

export function handleConnection(socket: net.Socket, deps: HandlerDeps) {
  const { config, routing, guardTelemetry } = deps;
  let remoteAddress = socket.remoteAddress ?? "0.0.0.0";
  let remotePort = socket.remotePort ?? 0;

  let buffer = Buffer.alloc(0);
  let phase: "await-handshake" | "post-handshake" | "proxying" | "closed" = "await-handshake";
  let handshake: MinecraftHandshake | null = null;
  let proxyProtocolChecked = !config.acceptProxyProtocol;
  let currentRoute: RoutingRecord | null = null;
  let currentHostname: string | null = null;
  let usernameAttempted: string | null = null;
  let sessionId: string | null = null;
  let sessionStartedAt: number | null = null;
  let disconnectRecorded = false;

  const handshakeTimer = setTimeout(() => {
    if (phase === "await-handshake") {
      log.warn("handshake.timeout", { remoteAddress });
      destroy("handshake-timeout");
    }
  }, config.handshakeTimeoutMs);
  handshakeTimer.unref();

  function destroy(reason: string) {
    if (phase === "closed") return;
    recordDisconnect(reason);
    phase = "closed";
    clearTimeout(handshakeTimer);
    if (!socket.destroyed) {
      socket.destroy();
    }
    log.info("connection.closed", { remoteAddress, reason });
  }

  socket.setNoDelay(true);
  socket.on("error", () => destroy("socket-error"));
  socket.on("close", () => destroy("client-closed"));

  socket.on("data", (chunk) => {
    if (phase === "closed" || phase === "proxying") {
      return;
    }

    if (buffer.length + chunk.length > config.maxBufferBytes) {
      log.warn("buffer.overflow", { remoteAddress, size: buffer.length + chunk.length });
      destroy("buffer-overflow");
      return;
    }

    buffer = Buffer.concat([buffer, chunk]);

    if (!proxyProtocolChecked) {
      const proxyHeader = tryParseProxyProtocolHeader(buffer);
      if (proxyHeader.status === "pending") {
        return;
      }
      proxyProtocolChecked = true;
      if (proxyHeader.status === "invalid") {
        log.warn("proxy_protocol.invalid", { remoteAddress, reason: proxyHeader.reason });
        destroy(proxyHeader.reason);
        return;
      }
      if (proxyHeader.status === "valid") {
        if (proxyHeader.sourceAddress) remoteAddress = proxyHeader.sourceAddress;
        if (proxyHeader.sourcePort) remotePort = proxyHeader.sourcePort;
        buffer = buffer.subarray(proxyHeader.bytesConsumed);
        log.info("proxy_protocol.accepted", { remoteAddress, remotePort });
      }
    }

    if (phase === "await-handshake") {
      const parsed = tryParseHandshake(buffer);
      if (!parsed) {
        if (buffer.length > config.maxBufferBytes) {
          destroy("malformed-handshake");
        }
        return;
      }
      handshake = parsed;
      phase = "post-handshake";
      clearTimeout(handshakeTimer);
      metrics.totalHandshakes += 1;
      void onHandshake(parsed);
    }
  });

  async function onHandshake(hs: MinecraftHandshake) {
    const normalized = normalizeHostname(hs.rawHostname, {
      maxLength: config.maxHostnameLength
    });

    log.info("handshake", {
      remoteAddress,
      rawHostname: normalized.raw.length > 64 ? `${normalized.raw.slice(0, 64)}…` : normalized.raw,
      hostname: normalized.hostname,
      nextState: hs.nextState,
      protocol: hs.protocolVersion
    });
    currentHostname = normalized.hostname;

    if (!isValidHostnameShape(normalized.hostname)) {
      recordEvent(hs.nextState === 1 ? "ping" : "login_attempt", {
        hostname: normalized.hostname,
        disconnectReason: "invalid_hostname",
        metadata: { routeResult: "invalid_hostname" }
      });
      respondUnavailable(hs.nextState, MOTD_UNKNOWN, DISCONNECT_UNKNOWN);
      return;
    }

    const decision = await guardTelemetry.checkDecision(remoteAddress, normalized.hostname);
    if (await applyGuardDecision(hs, normalized.hostname, decision)) {
      return;
    }

    let route: RoutingRecord | null;
    try {
      route = await routing.resolve(normalized.hostname, {
        forceRefreshIfSleeping: hs.nextState === 2
      });
    } catch (error) {
      log.warn("routing.exception", {
        hostname: normalized.hostname,
        error: error instanceof Error ? error.message : "unknown"
      });
      respondUnavailable(hs.nextState, MOTD_MAINTENANCE, DISCONNECT_MAINTENANCE);
      return;
    }

    if (!route) {
      log.info("routing.unknown", { hostname: normalized.hostname });
      recordEvent(hs.nextState === 1 ? "ping" : "login_attempt", {
        hostname: normalized.hostname,
        disconnectReason: "unknown_server",
        metadata: { routeResult: "unknown" }
      });
      respondUnavailable(hs.nextState, MOTD_UNKNOWN, DISCONNECT_UNKNOWN);
      return;
    }
    currentRoute = route;

    log.info("routing.resolved", {
      hostname: normalized.hostname,
      serverId: route.serverId,
      backendHost: route.host,
      backendPort: route.port,
      status: route.status
    });

    routeByStatus(hs, route, normalized.hostname);
  }

  function routeByStatus(hs: MinecraftHandshake, route: RoutingRecord, hostname: string) {
    const status = route.status as RoutingStatus;
    usernameAttempted = getUsernameAttempted(hs);
    if (hs.nextState === 1) {
      recordEvent("ping", {
        route,
        hostname,
        metadata: { routeStatus: status }
      });
    } else {
      recordEvent("login_attempt", {
        route,
        hostname,
        usernameAttempted,
        metadata: { routeStatus: status }
      });
    }
    log.info("route.dispatch", {
      hostname,
      status,
      nextState: hs.nextState,
      bytesConsumed: hs.bytesConsumed,
      bufferedBytes: buffer.length,
      mode: status === "running" ? "backend_relay" : "local_response"
    });
    switch (status) {
      case "running":
        if (!route.host || !route.port) {
          respondUnavailable(hs.nextState, MOTD_MAINTENANCE, DISCONNECT_MAINTENANCE);
          return;
        }
        proxyToBackend(hs, route, hostname);
        return;

      case "sleeping":
        if (hs.nextState === 2) {
          routing.invalidate(hostname);
          void routing.wake(route.serverId, hostname);
          recordEvent("disconnect", {
            route,
            hostname,
            usernameAttempted,
            disconnectReason: "wake_triggered",
            metadata: { routeStatus: status, wakeTriggered: true }
          });
          respondLoginDisconnect(DISCONNECT_WAKING);
        } else {
          respondStatusOnly(MOTD_SLEEPING, route);
        }
        return;

      case "waking":
      case "starting":
        if (hs.nextState === 2) {
          recordEvent("disconnect", {
            route,
            hostname,
            usernameAttempted,
            disconnectReason: "server_waking",
            metadata: { routeStatus: status }
          });
          respondLoginDisconnect(DISCONNECT_WAKING);
        } else {
          respondStatusOnly(MOTD_WAKING, route);
        }
        return;

      case "stopping":
        if (hs.nextState === 2) {
          recordEvent("disconnect", {
            route,
            hostname,
            usernameAttempted,
            disconnectReason: "server_restarting",
            metadata: { routeStatus: status }
          });
          respondLoginDisconnect(DISCONNECT_RESTARTING);
        } else {
          respondStatusOnly(MOTD_RESTARTING, route);
        }
        return;

      case "stopped":
        if (hs.nextState === 2) {
          recordEvent("disconnect", {
            route,
            hostname,
            usernameAttempted,
            disconnectReason: "server_stopped",
            metadata: { routeStatus: status }
          });
          respondLoginDisconnect("Server is stopped. Start it from your panel.");
        } else {
          respondStatusOnly("Server is offline", route);
        }
        return;

      case "crashed":
        if (hs.nextState === 2) {
          recordEvent("disconnect", {
            route,
            hostname,
            usernameAttempted,
            disconnectReason: "server_crashed",
            metadata: { routeStatus: status }
          });
          respondLoginDisconnect("Server crashed. Restart from your panel.");
        } else {
          respondStatusOnly("Server crashed", route);
        }
        return;

      default:
        respondUnavailable(hs.nextState, MOTD_MAINTENANCE, DISCONNECT_MAINTENANCE);
    }
  }

  function proxyToBackend(hs: MinecraftHandshake, route: RoutingRecord, hostname: string) {
    const backend = net.createConnection({ host: route.host!, port: route.port! });
    backend.setNoDelay(true);
    let connected = false;

    const connectTimer = setTimeout(() => {
      if (!connected) {
        log.warn("backend.connect.timeout", {
          hostname,
          host: route.host,
          port: route.port
        });
        backend.destroy(new Error("backend connect timeout"));
      }
    }, config.backendConnectTimeoutMs);
    connectTimer.unref();

    backend.once("connect", () => {
      connected = true;
      clearTimeout(connectTimer);
      phase = "proxying";
      metrics.proxiedSessions += 1;
      sessionId = randomUUID();
      sessionStartedAt = Date.now();
      usernameAttempted = getUsernameAttempted(hs);

      if (config.enableProxyProtocol) {
        const header = buildProxyV2Header(
          remoteAddress,
          remotePort,
          socket.localAddress ?? "0.0.0.0",
          socket.localPort ?? config.listenPort
        );
        backend.write(header);
      }

      // Replay the original client bytes (handshake + any post-handshake packets)
      // exactly as received, then install the duplex pipes for everything else.
      const replayBytes = buffer.length;
      if (replayBytes > 0) {
        backend.write(buffer);
      }
      buffer = Buffer.alloc(0);

      socket.pipe(backend);
      backend.pipe(socket);

      log.info("backend.connected", {
        hostname,
        backendHost: route.host,
        backendPort: route.port,
        nextState: hs.nextState,
        bytesConsumed: hs.bytesConsumed,
        bytesReplayed: replayBytes,
        mode: "backend_relay"
      });
      recordEvent("login_success", {
        route,
        hostname,
        usernameAttempted,
        sessionId,
        metadata: {
          routeStatus: route.status,
          backendHost: route.host,
          backendPort: route.port
        }
      });
    });

    backend.once("error", (error) => {
      clearTimeout(connectTimer);
      metrics.backendConnectFailures += 1;
      routing.invalidate(hostname);
      log.warn("backend.connect.failed", {
        hostname,
        host: route.host,
        port: route.port,
        error: error instanceof Error ? error.message : "unknown"
      });
      if (!connected) {
        recordEvent("disconnect", {
          route,
          hostname,
          usernameAttempted,
          disconnectReason: "backend_connect_failed",
          metadata: {
            backendHost: route.host,
            backendPort: route.port,
            error: error instanceof Error ? error.message : "unknown"
          }
        });
        respondUnavailable(hs.nextState, MOTD_MAINTENANCE, DISCONNECT_MAINTENANCE);
      } else if (!socket.destroyed) {
        socket.destroy();
      }
    });

    const teardownBackend = () => {
      if (!backend.destroyed) backend.destroy();
    };
    socket.once("close", teardownBackend);
    backend.once("close", () => {
      recordDisconnect("backend-closed");
      if (!socket.destroyed) socket.destroy();
    });
  }

  async function applyGuardDecision(
    hs: MinecraftHandshake,
    hostname: string,
    decision: GuardDecision
  ) {
    if (decision.action === "shadow_throttle") {
      const delayMs = Math.max(250, Math.min(decision.delayMs ?? 1500, 30_000));
      recordEvent(hs.nextState === 1 ? "ping" : "login_attempt", {
        hostname,
        usernameAttempted: getUsernameAttempted(hs),
        metadata: {
          guardDecision: "shadow_throttle",
          delayMs,
          riskScore: decision.riskScore ?? 0
        }
      });
      await delay(delayMs);
      return false;
    }

    if (decision.action === "rate_limited") {
      const allowed = guardTelemetry.allowRateLimitedDecision(
        remoteAddress,
        hostname,
        decision.rateLimitPerMinute ?? 10
      );
      if (allowed) {
        return false;
      }
    }

    if (decision.action === "blocked" || decision.action === "rate_limited") {
      const action = decision.action === "blocked" ? "blocked" : "rate_limited";
      recordEvent(action, {
        hostname,
        usernameAttempted: getUsernameAttempted(hs),
        disconnectReason: decision.reason ?? action,
        metadata: {
          guardDecision: action,
          riskScore: decision.riskScore ?? 0,
          expiresAt: decision.expiresAt ?? null
        }
      });
      respondUnavailable(
        hs.nextState,
        decision.action === "blocked" ? "Connection blocked" : "Rate limited",
        decision.action === "blocked"
          ? "Connection blocked by Phantom Guard."
          : "Too many connections. Try again shortly."
      );
      return true;
    }

    return false;
  }

  function recordEvent(
    action: GuardAction,
    options: {
      route?: RoutingRecord | null;
      hostname?: string | null;
      usernameAttempted?: string | null;
      sessionId?: string | null;
      disconnectReason?: string | null;
      latencyMs?: number | null;
      metadata?: Record<string, unknown>;
    } = {}
  ) {
    const route = options.route ?? currentRoute;
    guardTelemetry.record({
      sourceIp: remoteAddress,
      serverId: route?.serverId ?? null,
      nodeId: route?.nodeId ?? null,
      hostname: options.hostname ?? currentHostname,
      usernameAttempted: options.usernameAttempted ?? usernameAttempted,
      onlineMode: route?.onlineMode ?? null,
      protocolVersion: handshake?.protocolVersion ?? null,
      action,
      disconnectReason: options.disconnectReason ?? null,
      latencyMs: options.latencyMs ?? null,
      sessionId: options.sessionId ?? sessionId,
      metadata: {
        ...options.metadata,
        remotePort,
        nextState: handshake?.nextState ?? null
      }
    });
  }

  function recordDisconnect(reason: string) {
    if (disconnectRecorded || !sessionId || !sessionStartedAt) {
      return;
    }
    disconnectRecorded = true;
    recordEvent("disconnect", {
      disconnectReason: reason,
      sessionId,
      usernameAttempted,
      metadata: {
        durationMs: Math.max(0, Date.now() - sessionStartedAt)
      }
    });
  }

  function getUsernameAttempted(hs: MinecraftHandshake) {
    if (usernameAttempted) return usernameAttempted;
    if (hs.nextState !== 2) return null;
    const loginBuffer = buffer.subarray(hs.bytesConsumed);
    usernameAttempted = tryParseLoginStart(loginBuffer);
    return usernameAttempted;
  }

  function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function respondLoginDisconnect(message: string) {
    metrics.loginDisconnects += 1;
    if (socket.destroyed) return;
    log.info("response.login_disconnect", {
      remoteAddress,
      hostname: handshake?.hostname ?? null,
      nextState: handshake?.nextState ?? null,
      bytesConsumed: handshake?.bytesConsumed ?? 0,
      mode: "local_response"
    });
    // Phantom-local disconnect — written to client only, never to the backend.
    socket.write(encodeLoginDisconnect(message));
    socket.end();
    phase = "closed";
    // Drain any further client bytes so they cannot accidentally be relayed.
    buffer = Buffer.alloc(0);
  }

  function respondStatusOnly(description: string, route: RoutingRecord | null) {
    metrics.pingResponses += 1;
    if (socket.destroyed) return;

    const statusBuffer = buffer.subarray(handshake?.bytesConsumed ?? 0);
    const requestPacket = readNextPacket(statusBuffer);

    const responsePayload = encodeStatusResponse({
      description,
      protocol: handshake?.protocolVersion ?? config.protocolVersion,
      versionLabel: route?.version ? `${config.versionLabel} ${route.version}` : config.versionLabel,
      max: 20,
      online: 0
    });
    // Phantom-local status payload — written to client only, never to the backend.
    socket.write(responsePayload);

    if (requestPacket) {
      const after = statusBuffer.subarray(requestPacket.bytes);
      const ping = readNextPacket(after);
      if (ping && ping.packet[0] === 0x01 && ping.packet.length >= 9) {
        socket.write(encodeStatusPong(ping.packet.subarray(1, 9)));
      }
    }
    log.info("response.status_only", {
      remoteAddress,
      hostname: handshake?.hostname ?? null,
      nextState: handshake?.nextState ?? null,
      bytesConsumed: handshake?.bytesConsumed ?? 0,
      bufferedAfterHandshake: statusBuffer.length,
      mode: "local_response"
    });
    socket.end();
    phase = "closed";
    buffer = Buffer.alloc(0);
  }

  function respondUnavailable(
    nextState: 1 | 2,
    motdMessage: string,
    disconnectMessage: string
  ) {
    if (nextState === 2) {
      respondLoginDisconnect(disconnectMessage);
    } else {
      respondStatusOnly(motdMessage, null);
    }
  }
}
