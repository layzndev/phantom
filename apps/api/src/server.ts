import { assertRuntimeConfig, env } from "./config/env.js";
import { createApp } from "./app.js";
import { disconnectDb } from "./db/client.js";
import {
  startNodeRuntimeMonitor,
  type NodeRuntimeMonitorHandle
} from "./modules/nodes/nodes.runtime.monitor.js";

assertRuntimeConfig();

const app = createApp();

const server = app.listen(env.port, env.host, () => {
  console.log(`Phantom API listening on http://${env.host}:${env.port}`);
});

const monitor: NodeRuntimeMonitorHandle | null = env.nodeMonitorEnabled
  ? startNodeRuntimeMonitor()
  : null;

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
