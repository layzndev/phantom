import { loadConfig } from "./config.js";
import { DockerRuntime } from "./docker.js";
import { PhantomAgent } from "./agent.js";
import { Logger } from "./logger.js";
import { PhantomApiClient } from "./phantom-api.js";
import { WorkloadReconciler } from "./reconciler.js";

async function main() {
  const config = loadConfig();
  const logger = new Logger(config.logLevel);

  logger.info("phantom agent booting", {
    agentId: config.agentId,
    nodeId: config.nodeId,
    apiUrl: config.apiUrl,
    pollIntervalMs: config.pollIntervalMs,
    heartbeatIntervalMs: config.heartbeatIntervalMs
  });

  const api = new PhantomApiClient(config);
  const docker = new DockerRuntime(logger);
  const reconciler = new WorkloadReconciler(config, api, docker, logger);
  const agent = new PhantomAgent(reconciler, logger, config.pollIntervalMs);

  const shutdown = async (signal: string) => {
    logger.info("shutdown requested", { signal });
    await agent.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await agent.start();
}

void main().catch((error) => {
  console.error(
    `[${new Date().toISOString()}] phantom-agent FATAL ${
      error instanceof Error ? error.message : "unknown error"
    }`
  );
  process.exit(1);
});
