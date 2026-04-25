import { loadConfig } from "./config.js";
import { DockerRuntime } from "./docker.js";
import { PhantomAgent } from "./agent.js";
import { RuntimeCleanupService } from "./cleanup.js";
import { Logger } from "./logger.js";
import { MinecraftConsoleStreamManager } from "./minecraft-console.js";
import { MinecraftOperationsProcessor } from "./minecraft.js";
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
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    dataDir: config.dataDir
  });

  const api = new PhantomApiClient(config);
  const docker = new DockerRuntime(logger, { dataDir: config.dataDir });
  const reconciler = new WorkloadReconciler(config, api, docker, logger);
  const cleanup = new RuntimeCleanupService(config, api, docker, logger);
  const minecraftOps = new MinecraftOperationsProcessor(api, docker, logger);
  const minecraftConsole = new MinecraftConsoleStreamManager(api, docker, logger);
  const agent = new PhantomAgent(
    reconciler,
    cleanup,
    minecraftOps,
    minecraftConsole,
    api,
    docker,
    config.nodeId,
    config.dataDir,
    logger,
    config.pollIntervalMs
  );

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
