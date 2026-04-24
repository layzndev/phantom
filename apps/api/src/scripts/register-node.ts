import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { disconnectDb } from "../db/client.js";
import { createNode } from "../modules/nodes/nodes.service.js";
import { createNodeSchema } from "../modules/nodes/nodes.schema.js";

const apiEnvPath = resolve(process.cwd(), ".env");

if (existsSync(apiEnvPath)) {
  dotenv.config({ path: apiEnvPath });
} else {
  dotenv.config();
}

async function ask(question: string, fallback?: string) {
  if (fallback) return fallback;
  const rl = createInterface({ input, output });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

async function askOptional(question: string, fallback?: string) {
  const value = await ask(question, fallback);
  return value === "" ? undefined : value;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to register a Phantom node.");
  }

  const payload: Record<string, unknown> = {
    id: await ask("Node id: ", process.env.NODE_ID),
    name: await ask("Node name: ", process.env.NODE_NAME),
    provider: await ask("Provider: ", process.env.NODE_PROVIDER),
    region: await ask("Region: ", process.env.NODE_REGION),
    internalHost: await ask("Internal host: ", process.env.NODE_INTERNAL_HOST),
    publicHost: await ask("Public host: ", process.env.NODE_PUBLIC_HOST),
    runtimeMode: await ask("Runtime mode (local|remote) [remote]: ", process.env.NODE_RUNTIME_MODE ?? "remote")
  };

  const totalRamMb = await askOptional("Total RAM MB [auto from heartbeat]: ", process.env.NODE_TOTAL_RAM_MB);
  const totalCpu = await askOptional("Total CPU cores [auto from heartbeat]: ", process.env.NODE_TOTAL_CPU);
  const portRangeStart = await askOptional("Port range start [auto from heartbeat]: ", process.env.NODE_PORT_RANGE_START);
  const portRangeEnd = await askOptional("Port range end [auto from heartbeat]: ", process.env.NODE_PORT_RANGE_END);

  if (totalRamMb !== undefined) payload.totalRamMb = totalRamMb;
  if (totalCpu !== undefined) payload.totalCpu = totalCpu;
  if (portRangeStart !== undefined) payload.portRangeStart = portRangeStart;
  if (portRangeEnd !== undefined) payload.portRangeEnd = portRangeEnd;

  const parsed = createNodeSchema.parse(payload);
  const result = await createNode(parsed);

  console.log(`Created node ${result.node.id} (${result.node.name}).`);
  console.log("Store this token now. It will not be shown again:");
  console.log(result.token);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDb();
  });
