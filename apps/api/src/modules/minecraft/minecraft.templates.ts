import { execFile } from "node:child_process";
import { promisify } from "node:util";

export type MinecraftTemplateFamily =
  | "vanilla"
  | "paper"
  | "purpur"
  | "forge"
  | "fabric";

export interface MinecraftTemplateDefaults {
  cpu: number;
  ramMb: number;
  diskGb: number;
}

export interface MinecraftTemplate {
  id: string;
  family: MinecraftTemplateFamily;
  displayName: string;
  description: string;
  image: string;
  defaultVersion: string;
  supportedVersions: string[];
  defaults: MinecraftTemplateDefaults;
  baseEnv: Record<string, string>;
}

type TemplateSeed = Omit<MinecraftTemplate, "defaultVersion" | "supportedVersions"> & {
  fallbackDefaultVersion: string;
  fallbackSupportedVersions: string[];
};

const execFileAsync = promisify(execFile);
const TEMPLATE_REFRESH_TTL_MS = 5 * 60_000;
const DOCKER_IMAGE = "itzg/minecraft-server:java21";

const templateSeeds: TemplateSeed[] = [
  {
    id: "vanilla-1.21",
    family: "vanilla",
    displayName: "Vanilla",
    description: "Serveur officiel Mojang, sans mod ni plugin.",
    image: DOCKER_IMAGE,
    fallbackDefaultVersion: "1.21.1",
    fallbackSupportedVersions: ["1.21.1", "1.21", "1.20.6", "1.20.4"],
    defaults: { cpu: 2, ramMb: 4096, diskGb: 10 },
    baseEnv: { TYPE: "VANILLA" }
  },
  {
    id: "paper-1.21",
    family: "paper",
    displayName: "Paper",
    description: "Fork performant compatible plugins Bukkit/Spigot.",
    image: DOCKER_IMAGE,
    fallbackDefaultVersion: "1.21.1",
    fallbackSupportedVersions: ["1.21.1", "1.21", "1.20.6", "1.20.4"],
    defaults: { cpu: 2, ramMb: 4096, diskGb: 10 },
    baseEnv: { TYPE: "PAPER" }
  },
  {
    id: "purpur-1.21",
    family: "purpur",
    displayName: "Purpur",
    description: "Fork de Paper avec options de gameplay avancées.",
    image: DOCKER_IMAGE,
    fallbackDefaultVersion: "1.21.1",
    fallbackSupportedVersions: ["1.21.1", "1.21", "1.20.6"],
    defaults: { cpu: 2, ramMb: 4096, diskGb: 10 },
    baseEnv: { TYPE: "PURPUR" }
  },
  {
    id: "fabric-1.21",
    family: "fabric",
    displayName: "Fabric",
    description: "Loader de mods moderne et leger.",
    image: DOCKER_IMAGE,
    fallbackDefaultVersion: "1.21.1",
    fallbackSupportedVersions: ["1.21.1", "1.21", "1.20.4"],
    defaults: { cpu: 2, ramMb: 4096, diskGb: 10 },
    baseEnv: { TYPE: "FABRIC" }
  },
  {
    id: "forge-1.20",
    family: "forge",
    displayName: "Forge",
    description: "Loader de mods classique, plus gourmand en ressources.",
    image: DOCKER_IMAGE,
    fallbackDefaultVersion: "1.20.1",
    fallbackSupportedVersions: ["1.20.1", "1.19.2"],
    defaults: { cpu: 3, ramMb: 6144, diskGb: 15 },
    baseEnv: { TYPE: "FORGE" }
  }
];

let templateCache: MinecraftTemplate[] = buildFallbackTemplates();
let lastRefreshAt = 0;
let refreshInFlight: Promise<MinecraftTemplate[]> | null = null;

export async function listMinecraftTemplates(): Promise<MinecraftTemplate[]> {
  await ensureTemplateCacheFresh();
  return templateCache;
}

export async function findMinecraftTemplate(id: string): Promise<MinecraftTemplate | null> {
  await ensureTemplateCacheFresh();
  return templateCache.find((template) => template.id === id) ?? null;
}

function buildFallbackTemplates(): MinecraftTemplate[] {
  return templateSeeds.map((seed) => ({
    ...seed,
    defaultVersion: seed.fallbackDefaultVersion,
    supportedVersions: seed.fallbackSupportedVersions
  }));
}

async function ensureTemplateCacheFresh() {
  const now = Date.now();
  if (now - lastRefreshAt < TEMPLATE_REFRESH_TTL_MS) {
    return templateCache;
  }

  if (!refreshInFlight) {
    refreshInFlight = refreshTemplateCatalog().finally(() => {
      refreshInFlight = null;
    });
  }

  return refreshInFlight;
}

async function refreshTemplateCatalog(): Promise<MinecraftTemplate[]> {
  const [resolvedLatest, vanillaVersions, paperVersions, purpurVersions] = await Promise.all([
    resolveLatestReleaseViaDocker(),
    fetchVanillaReleaseVersions(),
    fetchPaperVersions(),
    fetchPurpurVersions()
  ]);

  const latestStable = resolvedLatest ?? vanillaVersions[0] ?? "1.21.1";
  const sharedVersions = dedupeVersions([
    latestStable,
    ...paperVersions,
    ...purpurVersions,
    ...vanillaVersions
  ]).slice(0, 12);

  templateCache = templateSeeds.map((seed) => {
    const perFamilyVersions =
      seed.family === "paper"
        ? dedupeVersions([latestStable, ...paperVersions, ...sharedVersions])
        : seed.family === "purpur"
          ? dedupeVersions([latestStable, ...purpurVersions, ...sharedVersions])
          : seed.family === "forge"
            ? dedupeVersions([latestStable, ...sharedVersions])
            : dedupeVersions([latestStable, ...sharedVersions]);

    const supportedVersions = dedupeVersions([
      ...perFamilyVersions,
      ...seed.fallbackSupportedVersions
    ]).slice(0, 12);

    return {
      ...seed,
      defaultVersion: supportedVersions[0] ?? seed.fallbackDefaultVersion,
      supportedVersions
    };
  });

  lastRefreshAt = Date.now();
  return templateCache;
}

async function resolveLatestReleaseViaDocker(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("docker", [
      "run",
      "--rm",
      "--entrypoint",
      "mc-image-helper",
      DOCKER_IMAGE,
      "resolve-minecraft-version",
      "latest"
    ]);

    const resolved = stdout.trim();
    return isReleaseVersion(resolved) ? resolved : null;
  } catch (error) {
    console.warn("[minecraft] failed to resolve latest Minecraft version via Docker", {
      error: error instanceof Error ? error.message : "unknown"
    });
    return null;
  }
}

async function fetchVanillaReleaseVersions(): Promise<string[]> {
  try {
    const response = await fetch(
      "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json"
    );
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = (await response.json()) as {
      versions?: Array<{ id?: string; type?: string }>;
    };

    return dedupeVersions(
      (payload.versions ?? [])
        .filter((entry) => entry.type === "release" && typeof entry.id === "string")
        .map((entry) => entry.id as string)
    ).slice(0, 12);
  } catch (error) {
    console.warn("[minecraft] failed to fetch Mojang version manifest", {
      error: error instanceof Error ? error.message : "unknown"
    });
    return [];
  }
}

async function fetchPaperVersions(): Promise<string[]> {
  try {
    const response = await fetch("https://fill.papermc.io/v3/projects/paper");
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = (await response.json()) as {
      versions?: Array<{ projectVersion?: { id?: string } }>;
    };

    return dedupeVersions(
      (payload.versions ?? [])
        .map((entry) => entry.projectVersion?.id)
        .filter((entry): entry is string => typeof entry === "string" && isReleaseVersion(entry))
    ).slice(0, 12);
  } catch (error) {
    console.warn("[minecraft] failed to fetch Paper versions", {
      error: error instanceof Error ? error.message : "unknown"
    });
    return [];
  }
}

async function fetchPurpurVersions(): Promise<string[]> {
  try {
    const response = await fetch("https://api.purpurmc.org/v2/purpur");
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = (await response.json()) as {
      versions?: string[];
    };

    return dedupeVersions(
      (payload.versions ?? []).filter((entry) => isReleaseVersion(entry))
    ).slice(0, 12);
  } catch (error) {
    console.warn("[minecraft] failed to fetch Purpur versions", {
      error: error instanceof Error ? error.message : "unknown"
    });
    return [];
  }
}

function dedupeVersions(versions: string[]) {
  const unique = Array.from(
    new Set(versions.map((entry) => entry.trim()).filter((entry) => entry.length > 0))
  );

  unique.sort(compareReleaseVersionsDesc);
  return unique;
}

function compareReleaseVersionsDesc(left: string, right: string) {
  const leftParts = left.split(".").map((part) => Number(part));
  const rightParts = right.split(".").map((part) => Number(part));
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;
    if (leftValue !== rightValue) {
      return rightValue - leftValue;
    }
  }

  return 0;
}

function isReleaseVersion(value: string) {
  return /^\d+\.\d+(?:\.\d+)?$/.test(value);
}
