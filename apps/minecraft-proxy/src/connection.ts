import net from "node:net";
import type { ProxyConfig } from "./config.js";
import { log } from "./logger.js";
import { metrics } from "./metrics.js";
import { normalizeHostname, isValidHostnameShape } from "./hostname.js";
import {
  encodeLoginDisconnect,
  encodeStatusPong,
  encodeStatusResponse,
  readNextPacket,
  tryParseHandshake,
  type MinecraftHandshake
} from "./protocol.js";
import { buildProxyV2Header } from "./proxy-protocol.js";
import type { PhantomRoutingClient, RoutingRecord, RoutingStatus } from "./routing.js";

interface HandlerDeps {
  config: ProxyConfig;
  routing: PhantomRoutingClient;
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
  const { config, routing } = deps;
  const remoteAddress = socket.remoteAddress ?? "0.0.0.0";
  const remotePort = socket.remotePort ?? 0;

  let buffer = Buffer.alloc(0);
  let phase: "await-handshake" | "post-handshake" | "proxying" | "closed" = "await-handshake";
  let handshake: MinecraftHandshake | null = null;

  const handshakeTimer = setTimeout(() => {
    if (phase === "await-handshake") {
      log.warn("handshake.timeout", { remoteAddress });
      destroy("handshake-timeout");
    }
  }, config.handshakeTimeoutMs);
  handshakeTimer.unref();

  function destroy(reason: string) {
    if (phase === "closed") return;
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

    if (!isValidHostnameShape(normalized.hostname)) {
      respondUnavailable(hs.nextState, MOTD_UNKNOWN, DISCONNECT_UNKNOWN);
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
      respondUnavailable(hs.nextState, MOTD_UNKNOWN, DISCONNECT_UNKNOWN);
      return;
    }

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
    switch (route.status as RoutingStatus) {
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
          respondLoginDisconnect(DISCONNECT_WAKING);
        } else {
          respondStatusOnly(MOTD_SLEEPING, route);
        }
        return;

      case "waking":
      case "starting":
        if (hs.nextState === 2) {
          respondLoginDisconnect(DISCONNECT_WAKING);
        } else {
          respondStatusOnly(MOTD_WAKING, route);
        }
        return;

      case "stopping":
        if (hs.nextState === 2) {
          respondLoginDisconnect(DISCONNECT_RESTARTING);
        } else {
          respondStatusOnly(MOTD_RESTARTING, route);
        }
        return;

      case "stopped":
        if (hs.nextState === 2) {
          respondLoginDisconnect("Server is stopped. Start it from your panel.");
        } else {
          respondStatusOnly("Server is offline", route);
        }
        return;

      case "crashed":
        if (hs.nextState === 2) {
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

      if (config.enableProxyProtocol) {
        const header = buildProxyV2Header(
          remoteAddress,
          remotePort,
          socket.localAddress ?? "0.0.0.0",
          socket.localPort ?? config.listenPort
        );
        backend.write(header);
      }

      backend.write(buffer);
      buffer = Buffer.alloc(0);

      socket.pipe(backend);
      backend.pipe(socket);

      log.info("backend.connected", {
        hostname,
        backendHost: route.host,
        backendPort: route.port
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
      if (!socket.destroyed) socket.destroy();
    });
  }

  function respondLoginDisconnect(message: string) {
    metrics.loginDisconnects += 1;
    if (socket.destroyed) return;
    socket.write(encodeLoginDisconnect(message));
    socket.end();
    phase = "closed";
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
    socket.write(responsePayload);

    if (requestPacket) {
      const after = statusBuffer.subarray(requestPacket.bytes);
      const ping = readNextPacket(after);
      if (ping && ping.packet[0] === 0x01 && ping.packet.length >= 9) {
        socket.write(encodeStatusPong(ping.packet.subarray(1, 9)));
      }
    }
    socket.end();
    phase = "closed";
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
