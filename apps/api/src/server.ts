import { createServer, type IncomingMessage, ServerResponse } from "node:http";
import { assertRuntimeConfig, env } from "./config/env.js";
import { createApp } from "./app.js";
import { disconnectDb } from "./db/client.js";
import { createAuditLog } from "./modules/audit/audit.repository.js";
import {
  getMinecraftConsoleSession,
  enqueueMinecraftOperation,
  reconcileReservedMinecraftProxyPorts
} from "./modules/minecraft/minecraft.service.js";
import { minecraftConsoleGateway } from "./modules/minecraft/minecraft.console.gateway.js";
import {
  startMinecraftAutoSleepMonitor,
  type MinecraftAutoSleepMonitorHandle
} from "./modules/minecraft/minecraft.autosleep.monitor.js";
import {
  startIncidentMonitor,
  type IncidentMonitorHandle
} from "./modules/incidents/incidents.monitor.js";
import {
  startGuardRetentionMonitor,
  type GuardRetentionMonitorHandle
} from "./modules/guard/guard.service.js";
import {
  startNodeRuntimeMonitor,
  type NodeRuntimeMonitorHandle
} from "./modules/nodes/nodes.runtime.monitor.js";
import {
  startWorkloadDeleteMonitor,
  type WorkloadDeleteMonitorHandle
} from "./modules/workloads/workloads.delete.monitor.js";
import {
  startWorkloadQueuedStartMonitor,
  type WorkloadQueuedStartMonitorHandle
} from "./modules/workloads/workloads.queued-start.monitor.js";
import { adminSession } from "./middleware/security.js";
import { acceptWebSocket } from "./lib/websocket.js";
import { normalizeIp, parseIpAllowlist } from "./lib/ipAccess.js";
import { redeemConsoleTicket } from "./modules/platform/platform.console.tickets.js";

const wsAdminAllowlist = parseIpAllowlist(env.adminIpAllowlist);

assertRuntimeConfig();

const app = createApp();

const server = createServer(app);

server.on("upgrade", (req, socket, head) => {
  const upgradePath = safeRequestPath(req);
  console.info("[server] websocket upgrade requested", {
    path: upgradePath,
    upgrade: req.headers.upgrade,
    connection: req.headers.connection,
    host: req.headers.host,
    origin: req.headers.origin
  });
  void handleMinecraftConsoleUpgrade(req, socket, head).catch((error) => {
    console.error("[server] websocket upgrade failed", error);
    if (!socket.destroyed) {
      socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
      socket.destroy();
    }
  });
});

server.listen(env.port, env.host, () => {
  console.log(`Phantom API listening on http://${env.host}:${env.port}`);
  void reconcileReservedMinecraftProxyPorts().catch((error) => {
    console.error("[server] failed to reconcile reserved minecraft proxy ports", error);
  });
});

const monitor: NodeRuntimeMonitorHandle | null = env.nodeMonitorEnabled
  ? startNodeRuntimeMonitor()
  : null;
const workloadDeleteMonitor: WorkloadDeleteMonitorHandle | null = env.workloadDeleteMonitorEnabled
  ? startWorkloadDeleteMonitor()
  : null;
const workloadQueuedStartMonitor: WorkloadQueuedStartMonitorHandle | null =
  env.queuedStartMonitorEnabled ? startWorkloadQueuedStartMonitor() : null;
const minecraftAutoSleepMonitor: MinecraftAutoSleepMonitorHandle | null = env.autoSleepEnabled
  ? startMinecraftAutoSleepMonitor()
  : null;
const incidentMonitor: IncidentMonitorHandle = startIncidentMonitor();
const guardRetentionMonitor: GuardRetentionMonitorHandle = startGuardRetentionMonitor();

let shuttingDown = false;

async function shutdown(signal: string, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`[server] ${signal} received, draining`);

  server.close((err) => {
    if (err) console.error("[server] error while closing HTTP server", err);
  });

  try {
    if (monitor) await monitor.stop();
  } catch (err) {
    console.error("[server] error while stopping node monitor", err);
  }

  try {
    if (workloadDeleteMonitor) await workloadDeleteMonitor.stop();
  } catch (err) {
    console.error("[server] error while stopping workload delete monitor", err);
  }

  try {
    if (workloadQueuedStartMonitor) await workloadQueuedStartMonitor.stop();
  } catch (err) {
    console.error("[server] error while stopping workload queued-start monitor", err);
  }

  try {
    if (minecraftAutoSleepMonitor) await minecraftAutoSleepMonitor.stop();
  } catch (err) {
    console.error("[server] error while stopping minecraft autosleep monitor", err);
  }

  try {
    await incidentMonitor.stop();
  } catch (err) {
    console.error("[server] error while stopping incident monitor", err);
  }

  try {
    await guardRetentionMonitor.stop();
  } catch (err) {
    console.error("[server] error while stopping guard retention monitor", err);
  }

  try {
    await disconnectDb();
  } catch (err) {
    console.error("[server] error while disconnecting database", err);
  }

  process.exit(exitCode);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  console.error("[server] unhandled rejection", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[server] uncaught exception", err);
  void shutdown("uncaughtException", 1);
});

async function handleMinecraftConsoleUpgrade(
  req: IncomingMessage,
  socket: import("node:stream").Duplex,
  head: Buffer
) {
  const pathname = safeRequestPath(req);
  const match = pathname.match(/^\/runtime\/minecraft\/servers\/([0-9a-fA-F-]+)\/console$/);
  if (!match) {
    console.warn("[server] websocket upgrade rejected", {
      reason: "path_not_matched",
      path: pathname
    });
    rejectUpgrade(socket, 404, "Not Found");
    return;
  }

  if (!isWebSocketUpgradeRequest(req)) {
    console.warn("[server] websocket upgrade rejected", {
      reason: "missing_upgrade_headers",
      path: pathname,
      upgrade: req.headers.upgrade,
      connection: req.headers.connection
    });
    rejectUpgrade(socket, 400, "Bad Request");
    return;
  }

  const serverId = match[1];
  if (!serverId) {
    rejectUpgrade(socket, 400, "Bad Request");
    return;
  }

  // Two auth paths share this upgrade endpoint:
  //   1. Admin session cookie (Phantom UI itself).
  //   2. Single-use platform ticket (?ticket=phct_…) issued via
  //      /platform/.../console-url for the Hosting product.
  // Admin sessions still pay the admin IP allowlist; ticket-auth is
  // explicitly NOT behind the admin allowlist (the customer can be
  // anywhere on the internet).
  const ticketParam = extractTicketParam(req);
  let actorEmail = "admin";

  if (ticketParam) {
    const consumed = redeemConsoleTicket(ticketParam);
    if (!consumed || consumed.serverId !== serverId) {
      console.warn("[server] websocket upgrade rejected", {
        reason: "invalid_or_expired_ticket",
        path: pathname,
        serverId
      });
      rejectUpgrade(socket, 401, "Unauthorized");
      return;
    }
    actorEmail = `platform-token:${consumed.mintedBy}`;
    (req as ConsoleRequest).wsActor = {
      id: `tenant:${consumed.tenantId}`,
      email: actorEmail,
      role: "platform"
    };
  } else {
    if (!wsAdminAllowlist.isEmpty) {
      const ip = normalizeIp(extractWsClientIp(req, socket));
      if (!ip || !wsAdminAllowlist.matches(ip)) {
        console.warn("[server] websocket upgrade rejected", {
          reason: "ip_not_in_admin_allowlist",
          path: pathname,
          ip: ip ?? "unknown"
        });
        void createAuditLog({
          action: "admin.ip_blocked",
          actorEmail: "anonymous",
          targetType: "system",
          metadata: { ip: ip ?? "unknown", path: pathname, channel: "websocket" }
        }).catch(() => undefined);
        rejectUpgrade(socket, 403, "Forbidden");
        return;
      }
    }

    await loadAdminSession(req);
    const admin = (req as IncomingMessage & { session?: { admin?: { id: string; email: string; role: string } }; sessionID?: string }).session?.admin;
    if (!admin) {
      console.warn("[server] websocket upgrade rejected", {
        reason: "unauthorized",
        path: pathname
      });
      rejectUpgrade(socket, 401, "Unauthorized");
      return;
    }
    actorEmail = admin.email;
    (req as ConsoleRequest).wsActor = admin;
  }

  const detail = await getMinecraftConsoleSession(serverId);
  let detach: () => void = () => {};
  const connection = acceptWebSocket(req, socket, head, {
    onText: (message) => {
      void handleConsoleMessage(req as ConsoleRequest, serverId, message, detail.workload.id).catch(
        (error) => {
          connection?.sendJson({
            type: "error",
            message: error instanceof Error ? error.message : "Unknown console error"
          });
        }
      );
    },
    onClose: () => detach()
  });
  if (!connection) {
    console.warn("[server] websocket upgrade rejected", {
      reason: "handshake_failed",
      path: pathname,
      serverId
    });
    return;
  }

  detach = minecraftConsoleGateway.attach(
    connection,
    detail.server.id,
    detail.workload.id
  );

  console.info("[server] websocket upgrade accepted", {
    path: pathname,
    serverId,
    workloadId: detail.workload.id,
    actor: actorEmail
  });
  connection.sendJson({
    type: "status",
    status: detail.server.runtimeState,
    timestamp: new Date().toISOString()
  });
}

async function handleConsoleMessage(
  req: ConsoleRequest,
  serverId: string,
  rawMessage: string,
  workloadId: string
) {
  const admin = req.wsActor ?? req.session?.admin;
  if (!admin) {
    throw new Error("Authentication required.");
  }

  const message = JSON.parse(rawMessage) as Record<string, unknown>;

  if (message.type === "command" && typeof message.command === "string") {
    await enqueueMinecraftOperation(
      serverId,
      "command",
      {
        command: message.command,
        ...(typeof message.id === "string" ? { clientRequestId: message.id } : {})
      },
      admin
    );
    await createAuditLog({
      action: "minecraft.server.command",
      actorId: admin.id,
      actorEmail: admin.email,
      targetType: "system",
      targetId: serverId,
      metadata: { command: message.command, via: "websocket" },
      ipAddress: req.socket.remoteAddress,
      userAgent: Array.isArray(req.headers["user-agent"])
        ? req.headers["user-agent"][0]
        : req.headers["user-agent"],
      sessionId: req.sessionID
    });
    return;
  }

  if (message.type === "action" && message.action === "save-all") {
    await enqueueMinecraftOperation(serverId, "save", {}, admin);
    await createAuditLog({
      action: "minecraft.server.save",
      actorId: admin.id,
      actorEmail: admin.email,
      targetType: "system",
      targetId: serverId,
      metadata: { via: "websocket" },
      ipAddress: req.socket.remoteAddress,
      userAgent: Array.isArray(req.headers["user-agent"])
        ? req.headers["user-agent"][0]
        : req.headers["user-agent"],
      sessionId: req.sessionID
    });
    return;
  }

  if (message.type === "action" && message.action === "stop") {
    await enqueueMinecraftOperation(serverId, "stop", {}, admin);
    await createAuditLog({
      action: "minecraft.server.stop",
      actorId: admin.id,
      actorEmail: admin.email,
      targetType: "system",
      targetId: serverId,
      metadata: { via: "websocket", graceful: true },
      ipAddress: req.socket.remoteAddress,
      userAgent: Array.isArray(req.headers["user-agent"])
        ? req.headers["user-agent"][0]
        : req.headers["user-agent"],
      sessionId: req.sessionID
    });
    return;
  }

  minecraftConsoleGateway.publishError(workloadId, "Unsupported console message.");
}

async function loadAdminSession(req: IncomingMessage) {
  await new Promise<void>((resolve, reject) => {
    const res = new ServerResponse(req);
    adminSession(req as never, res as never, (error?: unknown) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

type ConsoleRequest = IncomingMessage & {
  session?: {
    admin?: { id: string; email: string; role: string };
  };
  sessionID?: string;
  wsActor?: { id: string; email: string; role: string };
};

function isWebSocketUpgradeRequest(req: IncomingMessage) {
  const upgrade = typeof req.headers.upgrade === "string" ? req.headers.upgrade.toLowerCase() : "";
  const connection = typeof req.headers.connection === "string" ? req.headers.connection.toLowerCase() : "";
  return upgrade === "websocket" && connection.includes("upgrade");
}

function extractTicketParam(req: IncomingMessage): string | null {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const ticket = url.searchParams.get("ticket");
    return ticket && ticket.length > 0 ? ticket : null;
  } catch {
    return null;
  }
}

function extractWsClientIp(req: IncomingMessage, socket: import("node:stream").Duplex) {
  // Honor X-Forwarded-For only when the deployment is configured to trust
  // the proxy in front (matches Express's `trust proxy` behavior).
  if (env.trustProxy) {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.length > 0) {
      const first = forwarded.split(",")[0]?.trim();
      if (first) return first;
    }
  }
  const remote = (socket as unknown as { remoteAddress?: string }).remoteAddress;
  return remote ?? null;
}

function safeRequestPath(req: IncomingMessage) {
  try {
    return new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`).pathname;
  } catch {
    return req.url ?? "/";
  }
}

function rejectUpgrade(socket: import("node:stream").Duplex, statusCode: number, reason: string) {
  socket.write(`HTTP/1.1 ${statusCode} ${reason}\r\n\r\n`);
  socket.destroy();
}
