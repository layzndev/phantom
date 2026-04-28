import net from "node:net";
import { loadConfig } from "./config.js";
import { handleConnection } from "./connection.js";
import { log } from "./logger.js";
import { metrics, startMetricsLogger } from "./metrics.js";
import { IpRateLimiter } from "./rate-limit.js";
import { PhantomRoutingClient } from "./routing.js";
import { GuardTelemetryClient } from "./guard-telemetry.js";

const config = loadConfig();
const routing = new PhantomRoutingClient(config);
const rateLimiter = new IpRateLimiter(config.rateLimitBurst, config.rateLimitPerMinute);
const guardTelemetry = new GuardTelemetryClient(config);

const server = net.createServer({ allowHalfOpen: false }, (socket) => {
  metrics.totalConnections += 1;
  metrics.activeConnections += 1;
  socket.once("close", () => {
    metrics.activeConnections -= 1;
  });

  if (metrics.activeConnections > config.maxConnections) {
    log.warn("connection.rejected.cap", {
      remoteAddress: socket.remoteAddress,
      activeConnections: metrics.activeConnections
    });
    socket.destroy();
    return;
  }

  const remote = socket.remoteAddress ?? "0.0.0.0";
  if (!rateLimiter.allow(remote)) {
    metrics.rateLimited += 1;
    log.warn("connection.rejected.rate", { remoteAddress: remote });
    guardTelemetry.record({
      sourceIp: remote,
      action: "rate_limited",
      disconnectReason: "proxy_rate_limit",
      metadata: { layer: "proxy_global_rate_limit" }
    });
    socket.destroy();
    return;
  }

  socket.setTimeout(config.handshakeTimeoutMs * 4, () => {
    socket.destroy();
  });

  handleConnection(socket, { config, routing, guardTelemetry });
});

server.on("error", (error) => {
  log.error("server.error", {
    error: error instanceof Error ? error.message : "unknown"
  });
});

server.listen(config.listenPort, config.listenHost, () => {
  log.info("server.listening", {
    host: config.listenHost,
    port: config.listenPort,
    rootDomain: config.rootDomain,
    proxyProtocol: config.enableProxyProtocol
  });
});

const metricsTimer = startMetricsLogger(config.metricsLogIntervalMs);

function shutdown(signal: string) {
  log.info("server.shutdown", { signal });
  clearInterval(metricsTimer);
  void guardTelemetry.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("uncaughtException", (error) => {
  log.error("uncaughtException", {
    error: error instanceof Error ? error.message : "unknown",
    stack: error instanceof Error ? error.stack : undefined
  });
});
process.on("unhandledRejection", (reason) => {
  log.error("unhandledRejection", {
    reason: reason instanceof Error ? reason.message : String(reason)
  });
});
