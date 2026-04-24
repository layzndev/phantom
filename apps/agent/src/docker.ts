import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Logger } from "./logger.js";
import type {
  AssignedWorkload,
  DockerContainerStats,
  DockerContainerSummary
} from "./types.js";

const execFileAsync = promisify(execFile);

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

type WorkloadRuntimeConfig = {
  env?: Record<string, string | number | boolean>;
  cmd?: string[];
  entrypoint?: string;
  workingDir?: string;
  user?: string;
};

export class DockerRuntime {
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.child("docker");
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

  async createContainer(workload: AssignedWorkload, nodeId: string) {
    const runtimeConfig = parseRuntimeConfig(workload.config);
    const name = buildContainerName(workload.name, workload.id);
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

  async stopContainer(containerId: string) {
    await this.runDocker(["stop", "-t", "10", containerId]);
  }

  async killContainer(containerId: string) {
    await this.runDocker(["kill", containerId]);
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

  return {
    env,
    cmd,
    entrypoint,
    workingDir,
    user
  };
}
