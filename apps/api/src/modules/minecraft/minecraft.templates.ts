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

const templates: MinecraftTemplate[] = [
  {
    id: "vanilla-1.21",
    family: "vanilla",
    displayName: "Vanilla",
    description: "Serveur officiel Mojang, sans mod ni plugin.",
    image: "itzg/minecraft-server:java21",
    defaultVersion: "1.21.1",
    supportedVersions: ["1.21.1", "1.21", "1.20.6", "1.20.4"],
    defaults: { cpu: 2, ramMb: 4096, diskGb: 10 },
    baseEnv: { TYPE: "VANILLA" }
  },
  {
    id: "paper-1.21",
    family: "paper",
    displayName: "Paper",
    description: "Fork performant compatible plugins Bukkit/Spigot.",
    image: "itzg/minecraft-server:java21",
    defaultVersion: "1.21.1",
    supportedVersions: ["1.21.1", "1.21", "1.20.6", "1.20.4"],
    defaults: { cpu: 2, ramMb: 4096, diskGb: 10 },
    baseEnv: { TYPE: "PAPER" }
  },
  {
    id: "purpur-1.21",
    family: "purpur",
    displayName: "Purpur",
    description: "Fork de Paper avec options de gameplay avancées.",
    image: "itzg/minecraft-server:java21",
    defaultVersion: "1.21.1",
    supportedVersions: ["1.21.1", "1.21", "1.20.6"],
    defaults: { cpu: 2, ramMb: 4096, diskGb: 10 },
    baseEnv: { TYPE: "PURPUR" }
  },
  {
    id: "fabric-1.21",
    family: "fabric",
    displayName: "Fabric",
    description: "Loader de mods moderne et léger.",
    image: "itzg/minecraft-server:java21",
    defaultVersion: "1.21.1",
    supportedVersions: ["1.21.1", "1.21", "1.20.4"],
    defaults: { cpu: 2, ramMb: 4096, diskGb: 10 },
    baseEnv: { TYPE: "FABRIC" }
  },
  {
    id: "forge-1.20",
    family: "forge",
    displayName: "Forge",
    description: "Loader de mods classique, plus gourmand en ressources.",
    image: "itzg/minecraft-server:java21",
    defaultVersion: "1.20.1",
    supportedVersions: ["1.20.1", "1.19.2"],
    defaults: { cpu: 3, ramMb: 6144, diskGb: 15 },
    baseEnv: { TYPE: "FORGE" }
  }
];

export function listMinecraftTemplates(): MinecraftTemplate[] {
  return templates;
}

export function findMinecraftTemplate(id: string): MinecraftTemplate | null {
  return templates.find((template) => template.id === id) ?? null;
}
