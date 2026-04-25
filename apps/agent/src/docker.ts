import { execFile } from "node:child_process";
import { access, mkdir, rm } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { promisify } from "node:util";
import { Logger } from "./logger.js";
import type {
  AssignedWorkload,
  DockerContainerStats,
  DockerContainerSummary
} from "./types.js";

const execFileAsync = promisify(execFile);
const DEFAULT_STOP_TIMEOUT_SECONDS = 10;
const MAX_STOP_TIMEOUT_SECONDS = 600;

type DockerInspectContainer = {
  Id: string;
  Name: string;
  Created?: string;
  Config?: {
    Image?: string;
    Labels?: Record<string, string>;
  };
  State?: {
    Status?: string;
    Running?: boolean;
    ExitCode?: number;
    RestartCount?: number;
    StartedAt?: string;
    FinishedAt?: string;
  };
};

interface WorkloadVolumeSpec {
  name: string;
  containerPath: string;
  readOnly?: boolean;
}

type WorkloadRuntimeConfig = {
  env?: Record<string, string | number | boolean>;
  cmd?: string[];
  entrypoint?: string;
  workingDir?: string;
  user?: string;
  volumes?: WorkloadVolumeSpec[];
  stopTimeoutSeconds?: number;
};

export interface DockerRuntimeOptions {
  dataDir: string;
}

export class DockerRuntime {
  private readonly logger: Logger;
  private readonly dataDir: string;

  constructor(logger: Logger, options: DockerRuntimeOptions) {
    this.logger = logger.child("docker");
    this.dataDir = options.dataDir;
  }

  getStopTimeoutSeconds(config: Record<string, unknown>) {
    return parseRuntimeConfig(config).stopTimeoutSeconds ?? DEFAULT_STOP_TIMEOUT_SECONDS;
  }

  async listManagedContainers(nodeId: string) {
    const { stdout } = await this.runDocker([
      "ps",
      "-a",
      "--filter",
      "label=phantom.managed=true",
      "--filter",
      `label=phantom.node.id=${nodeId}`,
      "--format",
      "{{json .}}"
    ]);

    const ids = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { ID: string })
      .map((row) => row.ID);

    if (ids.length === 0) {
      return [] as DockerContainerSummary[];
    }

    const inspected = await this.inspectMany(ids);
    return inspected
      .map((container) => toContainerSummary(container))
      .filter((container): container is DockerContainerSummary => container !== null)
      .sort((left, right) => {
        const leftDate = left.createdAt ? Date.parse(left.createdAt) : 0;
        const rightDate = right.createdAt ? Date.parse(right.createdAt) : 0;
        return rightDate - leftDate;
      });
  }

  async pullImage(image: string) {
    await this.runDocker(["pull", image]);
  }

  async getDockerVersion() {
    const { stdout } = await this.runDocker(["version", "--format", "{{.Server.Version}}"]);
    return stdout.trim();
  }

  async createContainer(workload: AssignedWorkload, nodeId: string) {
    const runtimeConfig = parseRuntimeConfig(workload.config);
    const name = buildContainerName(workload.name, workload.id);

    if (await this.removeContainerByName(name, { force: true })) {
      this.logger.info("removed stale container with conflicting name before create", {
        name,
        workloadId: workload.id
      });
    }

    const args = [
      "create",
      "--name",
      name,
      "--label",
      "phantom.managed=true",
      "--label",
      `phantom.node.id=${nodeId}`,
      "--label",
      `phantom.workload.id=${workload.id}`,
      "--label",
      `phantom.workload.name=${workload.name}`,
      "--label",
      `phantom.workload.type=${workload.type}`,
      "--cpus",
      String(workload.requestedCpu),
      "--memory",
      `${workload.requestedRamMb}m`
    ];

    for (const port of workload.ports) {
      args.push(
        "-p",
        `${port.externalPort}:${port.internalPort}/${port.protocol}`
      );
    }

    const volumeMounts = await this.prepareVolumes(workload.id, runtimeConfig.volumes);
    for (const mount of volumeMounts) {
      args.push("-v", mount);
    }

    if (runtimeConfig.workingDir) {
      args.push("--workdir", runtimeConfig.workingDir);
    }

    if (runtimeConfig.user) {
      args.push("--user", runtimeConfig.user);
    }

    if (runtimeConfig.entrypoint) {
      args.push("--entrypoint", runtimeConfig.entrypoint);
    }

    for (const [key, value] of Object.entries(runtimeConfig.env ?? {})) {
      args.push("--env", `${key}=${String(value)}`);
    }

    args.push(workload.image);

    if (runtimeConfig.cmd?.length) {
      args.push(...runtimeConfig.cmd);
    }

    const { stdout } = await this.runDocker(args);
    return stdout.trim();
  }

  async startContainer(containerId: string) {
    await this.runDocker(["start", containerId]);
  }

  async stopContainer(containerId: string, options: { timeoutSeconds?: number } = {}) {
    const timeout = clampStopTimeout(options.timeoutSeconds ?? DEFAULT_STOP_TIMEOUT_SECONDS);
    await this.runDocker(["stop", "-t", String(timeout), containerId]);
  }

  async killContainer(containerId: string) {
    await this.runDocker(["kill", containerId]);
  }

  async removeContainer(
    containerId: string,
    options: { force?: boolean } = {}
  ): Promise<boolean> {
    const args = ["rm"];
    if (options.force) args.push("-f");
    args.push(containerId);
    try {
      await this.runDocker(args);
      return true;
    } catch (error) {
      if (isNoSuchContainerError(error)) {
        return false;
      }
      throw error;
    }
  }

  async removeContainerByName(
    name: string,
    options: { force?: boolean } = {}
  ): Promise<boolean> {
    if (!name.startsWith("phantom-")) {
      throw new Error(
        `refusing to remove non-phantom container by name: ${name}`
      );
    }
    return this.removeContainer(name, options);
  }

  async stopAndRemoveContainer(
    containerId: string,
    options: { timeoutSeconds?: number } = {}
  ): Promise<boolean> {
    const timeout = clampStopTimeout(options.timeoutSeconds ?? DEFAULT_STOP_TIMEOUT_SECONDS);
    try {
      await this.runDocker(["stop", "-t", String(timeout), containerId]);
    } catch (error) {
      if (isNoSuchContainerError(error)) {
        return false;
      }
      this.logger.debug("docker stop failed before remove, proceeding with rm -f", {
        containerId,
        error: error instanceof Error ? error.message : "unknown"
      });
    }
    return this.removeContainer(containerId, { force: true });
  }

  async listManagedContainerIdsByWorkload(workloadId: string, nodeId: string) {
    const { stdout } = await this.runDocker([
      "ps",
      "-a",
      "--filter",
      "label=phantom.managed=true",
      "--filter",
      `label=phantom.node.id=${nodeId}`,
      "--filter",
      `label=phantom.workload.id=${workloadId}`,
      "--format",
      "{{.ID}}"
    ]);
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  async listPhantomNamedContainers(): Promise<DockerContainerSummary[]> {
    const { stdout } = await this.runDocker([
      "ps",
      "-a",
      "--filter",
      "name=^phantom-",
      "--format",
      "{{json .}}"
    ]);

    const ids = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { ID: string })
      .map((row) => row.ID);

    if (ids.length === 0) {
      return [];
    }

    const inspected = await this.inspectMany(ids);
    return inspected
      .map((container) => toContainerSummaryUnfiltered(container))
      .filter((container): container is DockerContainerSummary => container !== null);
  }

  async execInContainer(containerId: string, command: string[]) {
    return this.runDocker(["exec", containerId, ...command]);
  }

  async removeWorkloadData(workloadId: string): Promise<boolean> {
    const target = resolvePath(this.dataDir, "workloads", workloadId);
    try {
      await access(target);
    } catch {
      return false;
    }

    await rm(target, { recursive: true, force: true });
    return true;
  }

  async getContainerLogs(containerId: string, options: { tail?: number } = {}) {
    const args = ["logs"];
    if (options.tail !== undefined) {
      args.push("--tail", String(Math.max(1, Math.min(options.tail, 5000))));
    }
    args.push(containerId);
    const { stdout, stderr } = await this.runDocker(args);
    return [stdout, stderr].filter(Boolean).join("");
  }

  async inspectContainer(containerId: string) {
    const [container] = await this.inspectMany([containerId]);
    return container ? toContainerSummary(container) : null;
  }

  async getContainerStats(containerId: string): Promise<DockerContainerStats> {
    try {
      const { stdout } = await this.runDocker([
        "stats",
        "--no-stream",
        "--format",
        "{{json .}}",
        containerId
      ]);

      const row = JSON.parse(stdout.trim()) as {
        CPUPerc?: string;
        MemUsage?: string;
      };

      return {
        cpuPercent: parsePercent(row.CPUPerc),
        memoryMb: parseMemoryMb(row.MemUsage)
      };
    } catch (error) {
      this.logger.debug("docker stats unavailable", {
        containerId,
        error: error instanceof Error ? error.message : "unknown"
      });
      return {};
    }
  }

  isManagedContainer(
    container: DockerContainerSummary,
    nodeId: string,
    workloadId?: string
  ) {
    if (container.labels["phantom.managed"] !== "true") {
      return false;
    }

    if (container.labels["phantom.node.id"] !== nodeId) {
      return false;
    }

    if (workloadId && container.labels["phantom.workload.id"] !== workloadId) {
      return false;
    }

    return true;
  }

  private async prepareVolumes(workloadId: string, volumes: WorkloadVolumeSpec[] | undefined) {
    if (!volumes || volumes.length === 0) {
      return [] as string[];
    }

    const mounts: string[] = [];
    for (const volume of volumes) {
      const hostPath = this.resolveVolumeHostPath(workloadId, volume.name);
      await mkdir(hostPath, { recursive: true });
      const mode = volume.readOnly ? ":ro" : "";
      mounts.push(`${hostPath}:${volume.containerPath}${mode}`);
    }
    return mounts;
  }

  private resolveVolumeHostPath(workloadId: string, volumeName: string) {
    const safeName = sanitizeVolumeName(volumeName);
    return resolvePath(this.dataDir, "workloads", workloadId, safeName);
  }

  private async inspectMany(containerIds: string[]) {
    if (containerIds.length === 0) {
      return [] as DockerInspectContainer[];
    }

    const { stdout } = await this.runDocker(["inspect", ...containerIds]);
    return JSON.parse(stdout) as DockerInspectContainer[];
  }

  private async runDocker(args: string[]) {
    this.logger.debug("docker command", { args });

    try {
      return await execFileAsync("docker", args, {
        maxBuffer: 10 * 1024 * 1024
      });
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "stderr" in error &&
        typeof error.stderr === "string"
      ) {
        throw new Error(error.stderr.trim() || "Docker command failed");
      }

      throw error;
    }
  }
}

function toContainerSummary(container: DockerInspectContainer): DockerContainerSummary | null {
  const workloadId = container.Config?.Labels?.["phantom.workload.id"];
  if (!workloadId) {
    return null;
  }

  return toContainerSummaryUnfiltered(container);
}

function toContainerSummaryUnfiltered(
  container: DockerInspectContainer
): DockerContainerSummary {
  return {
    id: container.Id,
    name: container.Name.replace(/^\//, ""),
    image: container.Config?.Image ?? "",
    labels: container.Config?.Labels ?? {},
    stateStatus: container.State?.Status ?? "unknown",
    running: container.State?.Running ?? false,
    exitCode:
      typeof container.State?.ExitCode === "number" ? container.State.ExitCode : null,
    restartCount:
      typeof container.State?.RestartCount === "number" ? container.State.RestartCount : 0,
    startedAt: normalizeDate(container.State?.StartedAt),
    finishedAt: normalizeDate(container.State?.FinishedAt),
    createdAt: normalizeDate(container.Created)
  };
}

function isNoSuchContainerError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const message =
    "message" in error && typeof (error as { message: unknown }).message === "string"
      ? (error as { message: string }).message.toLowerCase()
      : "";
  return message.includes("no such container") || message.includes("is not running");
}

function normalizeDate(value: string | undefined) {
  if (!value || value.startsWith("0001-01-01")) {
    return null;
  }
  return value;
}

function buildContainerName(name: string, workloadId: string) {
  const safeName = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

  return `phantom-${safeName || "workload"}-${workloadId.slice(0, 12)}`;
}

function parsePercent(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const normalized = Number(value.replace("%", "").trim());
  return Number.isFinite(normalized) ? normalized : undefined;
}

function parseMemoryMb(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const current = value.split("/")[0]?.trim();
  if (!current) {
    return undefined;
  }

  const match = current.match(/^([\d.]+)\s*([kmgt]?i?b)$/i);
  if (!match) {
    return undefined;
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (!Number.isFinite(amount)) {
    return undefined;
  }

  const multiplier: Record<string, number> = {
    b: 1 / (1024 * 1024),
    kib: 1 / 1024,
    kb: 1 / 1000,
    mib: 1,
    mb: 1,
    gib: 1024,
    gb: 1000,
    tib: 1024 * 1024,
    tb: 1000 * 1000
  };

  const factor = multiplier[unit];
  return factor ? Math.round(amount * factor) : undefined;
}

function parseRuntimeConfig(config: Record<string, unknown>): WorkloadRuntimeConfig {
  const env =
    config.env && typeof config.env === "object" && !Array.isArray(config.env)
      ? Object.fromEntries(
          Object.entries(config.env).filter(([, value]) =>
            ["string", "number", "boolean"].includes(typeof value)
          )
        )
      : undefined;

  const cmd =
    Array.isArray(config.cmd) && config.cmd.every((value) => typeof value === "string")
      ? (config.cmd as string[])
      : undefined;

  const entrypoint =
    typeof config.entrypoint === "string" && config.entrypoint.length > 0
      ? config.entrypoint
      : undefined;

  const workingDir =
    typeof config.workingDir === "string" && config.workingDir.length > 0
      ? config.workingDir
      : undefined;

  const user =
    typeof config.user === "string" && config.user.length > 0 ? config.user : undefined;

  const volumes = parseVolumes(config.volumes);
  const stopTimeoutSeconds = parseStopTimeoutSeconds(config.stopTimeoutSeconds);

  return {
    env,
    cmd,
    entrypoint,
    workingDir,
    user,
    volumes,
    stopTimeoutSeconds
  };
}

function parseVolumes(raw: unknown): WorkloadVolumeSpec[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) {
    return undefined;
  }

  const parsed: WorkloadVolumeSpec[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
    const containerPath =
      typeof candidate.containerPath === "string" ? candidate.containerPath.trim() : "";
    if (!name || !containerPath) continue;
    if (!containerPath.startsWith("/")) continue;
    parsed.push({
      name,
      containerPath,
      readOnly: candidate.readOnly === true
    });
  }
  return parsed.length > 0 ? parsed : undefined;
}

function parseStopTimeoutSeconds(raw: unknown) {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return undefined;
  }
  if (raw < 0) {
    return undefined;
  }
  return Math.min(Math.round(raw), MAX_STOP_TIMEOUT_SECONDS);
}

function sanitizeVolumeName(name: string) {
  const normalized = name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized.slice(0, 64) : "data";
}

function clampStopTimeout(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return DEFAULT_STOP_TIMEOUT_SECONDS;
  }
  return Math.min(Math.round(seconds), MAX_STOP_TIMEOUT_SECONDS);
}
