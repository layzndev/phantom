import { readFileSync } from "node:fs";
import { statfs } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { arch, cpus, hostname, platform, release, totalmem, uptime } from "node:os";
import { fileURLToPath } from "node:url";
import { DockerRuntime } from "./docker.js";

const AGENT_PACKAGE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "..", "package.json");

export interface NodeSystemInfo {
  agentVersion: string | null;
  runtimeVersion: string;
  dockerVersion: string | null;
  osPlatform: string;
  osRelease: string;
  kernelVersion: string;
  osArch: string;
  hostname: string;
  uptimeSec: number;
  cpuModel: string | null;
  cpuCores: number;
  totalRamMb: number;
  totalCpu: number;
  totalDiskGb: number | null;
}

let cachedAgentVersion: string | null | undefined;

export async function collectNodeSystemInfo(
  docker: DockerRuntime,
  dataDir: string
): Promise<NodeSystemInfo> {
  const cpuList = cpus();
  const dockerVersion = await readDockerVersion(docker);
  const totalDiskGb = await readTotalDiskGb(dataDir);

  return {
    agentVersion: readAgentVersion(),
    runtimeVersion: process.version,
    dockerVersion,
    osPlatform: platform(),
    osRelease: release(),
    kernelVersion: release(),
    osArch: arch(),
    hostname: hostname(),
    uptimeSec: Math.round(uptime()),
    cpuModel: cpuList[0]?.model?.trim() || null,
    cpuCores: cpuList.length,
    totalRamMb: Math.round(totalmem() / (1024 * 1024)),
    totalCpu: cpuList.length,
    totalDiskGb
  };
}

function readAgentVersion() {
  if (cachedAgentVersion !== undefined) {
    return cachedAgentVersion;
  }

  try {
    const raw = readFileSync(AGENT_PACKAGE_PATH, "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    cachedAgentVersion =
      typeof parsed.version === "string" && parsed.version.trim().length > 0
        ? parsed.version.trim()
        : null;
  } catch {
    cachedAgentVersion = null;
  }

  return cachedAgentVersion;
}

async function readDockerVersion(docker: DockerRuntime) {
  try {
    const version = await docker.getDockerVersion();
    return version.length > 0 ? version : null;
  } catch {
    return null;
  }
}

async function readTotalDiskGb(pathname: string) {
  try {
    const stats = await statfs(pathname);
    const blockSize = Number(stats.bsize);
    const blocks = Number(stats.blocks);
    if (!Number.isFinite(blockSize) || !Number.isFinite(blocks) || blockSize <= 0 || blocks <= 0) {
      return null;
    }
    return Math.round((blockSize * blocks) / (1024 ** 3));
  } catch {
    return null;
  }
}
