import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { statfs } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  arch,
  cpus,
  hostname,
  loadavg,
  platform,
  release,
  totalmem,
  uptime
} from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { DockerRuntime } from "./docker.js";
import type { OpenPortCategory, WorkloadPortProtocol } from "./types.js";

const AGENT_PACKAGE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
const execFileAsync = promisify(execFile);
const DEFAULT_OPEN_PORT_RANGE = { start: 25_565, end: 26_065 };
const SYSTEM_OPEN_PORTS = new Set([22, 80, 443]);

type ProcStatSnapshot = {
  idle: number;
  total: number;
};

export interface OpenPortDetail {
  port: number;
  protocol: WorkloadPortProtocol;
  address: string;
  category: OpenPortCategory;
}

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

export interface NodeLiveMetrics {
  usedCpu?: number;
  usedRamMb?: number;
  loadAverage1m?: number;
  openPorts?: number[];
  openPortDetails?: OpenPortDetail[];
  dockerPublishedPorts?: Array<{
    containerId: string;
    containerName: string;
    workloadId: string | null;
    protocol: WorkloadPortProtocol;
    publishedPort: number;
    targetPort: number;
  }>;
}

export class NodeLiveMetricsCollector {
  private previousProcStat: ProcStatSnapshot | null = null;

  constructor(
    private readonly docker: DockerRuntime,
    private readonly nodeId: string
  ) {}

  async collect(): Promise<NodeLiveMetrics> {
    const [openPorts, dockerPublishedPorts] = await Promise.all([
      collectOpenPorts(),
      this.readDockerPublishedPorts()
    ]);
    return {
      usedCpu: this.readUsedCpu(),
      usedRamMb: this.readUsedRamMb(),
      loadAverage1m: readLoadAverage1m(),
      ...(openPorts ? { openPorts: openPorts.ports, openPortDetails: openPorts.details } : {}),
      ...(dockerPublishedPorts ? { dockerPublishedPorts } : {})
    };
  }

  private readUsedCpu() {
    const cpuCount = cpus().length;
    if (cpuCount <= 0) {
      return undefined;
    }

    const current = readProcStatSnapshot();
    if (!current) {
      return undefined;
    }

    const previous = this.previousProcStat;
    this.previousProcStat = current;
    if (!previous) {
      return undefined;
    }

    const totalDelta = current.total - previous.total;
    const idleDelta = current.idle - previous.idle;
    if (totalDelta <= 0) {
      return undefined;
    }

    const usageFraction = Math.max(0, Math.min(1, 1 - idleDelta / totalDelta));
    const usedCpu = usageFraction * cpuCount;
    return Number(usedCpu.toFixed(1));
  }

  private readUsedRamMb() {
    try {
      const raw = readFileSync("/proc/meminfo", "utf8");
      const totalKb = readMemInfoValue(raw, "MemTotal");
      const availableKb = readMemInfoValue(raw, "MemAvailable");
      if (totalKb === null || availableKb === null) {
        return undefined;
      }
      const usedKb = Math.max(0, totalKb - availableKb);
      return Math.round(usedKb / 1024);
    } catch {
      return undefined;
    }
  }

  private async readDockerPublishedPorts() {
    try {
      const bindings = await this.docker.listManagedContainerPortBindings(this.nodeId);
      return bindings.length > 0 ? bindings : [];
    } catch {
      return undefined;
    }
  }
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

function readMemInfoValue(content: string, key: string) {
  const match = content.match(new RegExp(`^${key}:\\s+(\\d+)\\s+kB$`, "m"));
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function readProcStatSnapshot(): ProcStatSnapshot | null {
  try {
    const raw = readFileSync("/proc/stat", "utf8");
    const line = raw.split(/\r?\n/).find((entry) => entry.startsWith("cpu "));
    if (!line) {
      return null;
    }

    const values = line
      .trim()
      .split(/\s+/)
      .slice(1)
      .map((value) => Number(value));

    if (values.length < 4 || values.some((value) => !Number.isFinite(value))) {
      return null;
    }

    const idle = (values[3] ?? 0) + (values[4] ?? 0);
    const total = values.reduce((sum, value) => sum + value, 0);
    return { idle, total };
  } catch {
    return null;
  }
}

function readLoadAverage1m() {
  const value = loadavg()[0];
  return Number.isFinite(value) ? Number(value.toFixed(2)) : undefined;
}

async function collectOpenPorts(): Promise<{ ports: number[]; details: OpenPortDetail[] } | null> {
  const fromSs = await readOpenPortsFromSs();
  if (fromSs) {
    return fromSs;
  }

  return readOpenPortsFromProc();
}

async function readOpenPortsFromSs(): Promise<{ ports: number[]; details: OpenPortDetail[] } | null> {
  try {
    const { stdout } = await execFileAsync("ss", ["-H", "-tuln"], {
      timeout: 5_000,
      maxBuffer: 2 * 1024 * 1024
    });

    return normalizeOpenPorts(
      stdout
        .split(/\r?\n/)
        .map(parseSsLine)
        .filter((entry): entry is OpenPortDetail => entry !== null)
    );
  } catch {
    return null;
  }
}

function parseSsLine(line: string): OpenPortDetail | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  const columns = trimmed.split(/\s+/);
  if (columns.length < 5) {
    return null;
  }

  const protocol = normalizeProtocol(columns[0] ?? "");
  if (!protocol) {
    return null;
  }

  const localAddress = columns[4] ?? "";
  return parseSocketAddress(localAddress, protocol);
}

function readOpenPortsFromProc(): { ports: number[]; details: OpenPortDetail[] } | null {
  const entries = [
    ...readProcNetEntries("/proc/net/tcp", "tcp"),
    ...readProcNetEntries("/proc/net/tcp6", "tcp"),
    ...readProcNetEntries("/proc/net/udp", "udp"),
    ...readProcNetEntries("/proc/net/udp6", "udp")
  ];

  if (entries.length === 0) {
    return null;
  }

  return normalizeOpenPorts(entries);
}

function readProcNetEntries(
  pathname: string,
  protocol: WorkloadPortProtocol
): OpenPortDetail[] {
  try {
    const content = readFileSync(pathname, "utf8");
    return content
      .split(/\r?\n/)
      .slice(1)
      .map((line) => parseProcNetLine(line, protocol))
      .filter((entry): entry is OpenPortDetail => entry !== null);
  } catch {
    return [];
  }
}

function parseProcNetLine(
  line: string,
  protocol: WorkloadPortProtocol
): OpenPortDetail | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  const columns = trimmed.split(/\s+/);
  if (columns.length < 2) {
    return null;
  }

  const state = columns[3] ?? "";
  if (protocol === "tcp" && state !== "0A") {
    return null;
  }

  const local = columns[1] ?? "";
  const [encodedAddress, encodedPort] = local.split(":");
  const port = Number.parseInt(encodedPort ?? "", 16);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return null;
  }

  const address = decodeProcAddress(encodedAddress ?? "");
  if (!address) {
    return null;
  }

  return toOpenPortDetail(address, port, protocol);
}

function decodeProcAddress(encoded: string) {
  if (encoded.length === 8) {
    const octets = encoded.match(/../g);
    if (!octets) {
      return null;
    }

    const bytes = octets.map((entry) => Number.parseInt(entry, 16)).reverse();
    if (bytes.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
      return null;
    }

    const dotted = bytes.join(".");
    return dotted === "0.0.0.0" ? "0.0.0.0" : dotted;
  }

  if (encoded.length === 32) {
    const groups = encoded.match(/.{1,8}/g);
    if (!groups || groups.length !== 4) {
      return null;
    }

    const normalized = groups
      .map((group) =>
        group.match(/../g)?.reverse().join("") ?? ""
      )
      .join(":")
      .toLowerCase()
      .replace(/\b0{1,3}/g, "0");

    if (normalized === "00000000:00000000:00000000:00000000") {
      return "::";
    }

    return compressIpv6(normalized);
  }

  return null;
}

function compressIpv6(value: string) {
  const groups = value.split(":").map((group) => group.replace(/^0+/, "") || "0");
  let bestStart = -1;
  let bestLength = 0;
  let currentStart = -1;
  let currentLength = 0;

  for (let index = 0; index < groups.length; index += 1) {
    if (groups[index] === "0") {
      if (currentStart === -1) {
        currentStart = index;
        currentLength = 1;
      } else {
        currentLength += 1;
      }
    } else if (currentStart !== -1) {
      if (currentLength > bestLength) {
        bestStart = currentStart;
        bestLength = currentLength;
      }
      currentStart = -1;
      currentLength = 0;
    }
  }

  if (currentStart !== -1 && currentLength > bestLength) {
    bestStart = currentStart;
    bestLength = currentLength;
  }

  if (bestLength < 2) {
    return groups.join(":");
  }

  const left = groups.slice(0, bestStart).join(":");
  const right = groups.slice(bestStart + bestLength).join(":");
  if (!left && !right) {
    return "::";
  }
  if (!left) {
    return `::${right}`;
  }
  if (!right) {
    return `${left}::`;
  }
  return `${left}::${right}`;
}

function parseSocketAddress(
  value: string,
  protocol: WorkloadPortProtocol
): OpenPortDetail | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const ipv6Match = trimmed.match(/^\[(.+)\]:(\d+)$/);
  if (ipv6Match) {
    return toOpenPortDetail(ipv6Match[1] ?? "::", Number(ipv6Match[2]), protocol);
  }

  const separator = trimmed.lastIndexOf(":");
  if (separator === -1) {
    return null;
  }

  const address = trimmed.slice(0, separator) || "0.0.0.0";
  const port = Number(trimmed.slice(separator + 1));
  return toOpenPortDetail(address === "*" ? "0.0.0.0" : address, port, protocol);
}

function toOpenPortDetail(
  address: string,
  port: number,
  protocol: WorkloadPortProtocol
): OpenPortDetail | null {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return null;
  }

  const normalizedAddress = normalizeAddress(address);
  const category = classifyOpenPort(port);
  if (!category) {
    return null;
  }

  return {
    port,
    protocol,
    address: normalizedAddress,
    category
  };
}

function normalizeAddress(address: string) {
  if (address === "*" || address === "0.0.0.0:*") {
    return "0.0.0.0";
  }
  if (address === "[::]" || address === "*") {
    return "::";
  }
  return address;
}

function normalizeProtocol(value: string): WorkloadPortProtocol | null {
  if (value.startsWith("tcp")) {
    return "tcp";
  }
  if (value.startsWith("udp")) {
    return "udp";
  }
  return null;
}

function classifyOpenPort(port: number): OpenPortCategory | null {
  if (port >= DEFAULT_OPEN_PORT_RANGE.start && port <= DEFAULT_OPEN_PORT_RANGE.end) {
    return "phantom-range";
  }
  if (SYSTEM_OPEN_PORTS.has(port)) {
    return "system";
  }
  return null;
}

function normalizeOpenPorts(details: OpenPortDetail[]) {
  const uniqueDetails = Array.from(
    new Map(
      details.map((entry) => [
        `${entry.protocol}:${entry.address}:${entry.port}`,
        entry
      ])
    ).values()
  ).sort((left, right) => {
    if (left.port !== right.port) {
      return left.port - right.port;
    }
    if (left.protocol !== right.protocol) {
      return left.protocol.localeCompare(right.protocol);
    }
    return left.address.localeCompare(right.address);
  });

  const ports = Array.from(new Set(uniqueDetails.map((entry) => entry.port))).sort(
    (left, right) => left - right
  );

  return { ports, details: uniqueDetails };
}
