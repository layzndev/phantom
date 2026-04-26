import { execFile } from "node:child_process";
import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, normalize, resolve as resolvePath } from "node:path";
import { promisify } from "node:util";
import { Logger } from "./logger.js";

const execFileAsync = promisify(execFile);
const MAX_TEXT_READ_BYTES = 2 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const FORBIDDEN_BASENAMES = new Set([
  ".env",
  "secrets",
  "secret",
  "token",
  "tokens",
  "phantom.json",
  "phantom.yml"
]);

export interface MinecraftFileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  sizeBytes: number;
  modifiedAt: string;
}

export class MinecraftFilesManager {
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.child("minecraft-files");
  }

  async list(baseDir: string, requestedPath: string) {
    const { relativePath, targetPath } = await this.resolveSandboxPath(baseDir, requestedPath, {
      allowMissing: false,
      allowRoot: true
    });

    const directoryStats = await lstat(targetPath);
    if (!directoryStats.isDirectory()) {
      throw new Error("Path is not a directory.");
    }

    const entries = await readdir(targetPath, { withFileTypes: true });
    const rows: MinecraftFileEntry[] = [];
    for (const entry of entries) {
      const childRelative = joinSandboxPath(relativePath, entry.name);
      const childAbsolute = await this.resolveSandboxPath(baseDir, childRelative, {
        allowMissing: false
      });
      const childStats = await lstat(childAbsolute.targetPath);
      if (childStats.isSymbolicLink()) {
        continue;
      }
      rows.push({
        name: entry.name,
        path: childRelative,
        type: childStats.isDirectory() ? "directory" : "file",
        sizeBytes: childStats.isDirectory() ? 0 : childStats.size,
        modifiedAt: childStats.mtime.toISOString()
      });
    }

    rows.sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === "directory" ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });

    return {
      path: toDisplayPath(relativePath),
      parentPath: relativePath === "." ? null : dirname(relativePath) === "." ? "/" : dirname(relativePath),
      entries: rows
    };
  }

  async readText(baseDir: string, requestedPath: string) {
    const { relativePath, targetPath } = await this.resolveSandboxPath(baseDir, requestedPath, {
      allowMissing: false
    });
    await this.assertEditableFile(targetPath);
    const fileStats = await stat(targetPath);
    if (fileStats.size > MAX_TEXT_READ_BYTES) {
      throw new Error("File too large to open in the text editor.");
    }
    const buffer = await readFile(targetPath);
    if (looksBinary(buffer)) {
      throw new Error("Binary files cannot be edited as text.");
    }
    return {
      path: toDisplayPath(relativePath),
      content: buffer.toString("utf8"),
      modifiedAt: fileStats.mtime.toISOString(),
      sizeBytes: fileStats.size,
      encoding: "utf-8" as const
    };
  }

  async writeText(baseDir: string, requestedPath: string, content: string) {
    const target = await this.resolveSandboxPath(baseDir, requestedPath, {
      allowMissing: true
    });
    await this.assertWritablePath(baseDir, target.relativePath);
    const parent = dirname(target.targetPath);
    await mkdir(parent, { recursive: true });
    const tempPath = resolvePath(tmpdir(), `phantom-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`);
    await writeFile(tempPath, content, "utf8");
    await rename(tempPath, target.targetPath);
    const fileStats = await stat(target.targetPath);
    return {
      path: toDisplayPath(target.relativePath),
      modifiedAt: fileStats.mtime.toISOString(),
      sizeBytes: fileStats.size
    };
  }

  async upload(baseDir: string, requestedPath: string, contentBase64: string) {
    const buffer = Buffer.from(contentBase64, "base64");
    if (buffer.byteLength > MAX_UPLOAD_BYTES) {
      throw new Error("Upload exceeds maximum allowed size.");
    }
    const target = await this.resolveSandboxPath(baseDir, requestedPath, {
      allowMissing: true
    });
    await this.assertWritablePath(baseDir, target.relativePath);
    await mkdir(dirname(target.targetPath), { recursive: true });
    await writeFile(target.targetPath, buffer);
    const fileStats = await stat(target.targetPath);
    return {
      path: toDisplayPath(target.relativePath),
      modifiedAt: fileStats.mtime.toISOString(),
      sizeBytes: fileStats.size
    };
  }

  async mkdir(baseDir: string, requestedPath: string) {
    const target = await this.resolveSandboxPath(baseDir, requestedPath, {
      allowMissing: true
    });
    await this.assertWritablePath(baseDir, target.relativePath);
    await mkdir(target.targetPath, { recursive: true });
    return { path: toDisplayPath(target.relativePath) };
  }

  async rename(baseDir: string, fromPath: string, toPath: string) {
    const from = await this.resolveSandboxPath(baseDir, fromPath, { allowMissing: false });
    const to = await this.resolveSandboxPath(baseDir, toPath, { allowMissing: true });
    await this.assertWritablePath(baseDir, from.relativePath);
    await this.assertWritablePath(baseDir, to.relativePath);
    await mkdir(dirname(to.targetPath), { recursive: true });
    await rename(from.targetPath, to.targetPath);
    return { from: toDisplayPath(from.relativePath), to: toDisplayPath(to.relativePath) };
  }

  async delete(baseDir: string, requestedPath: string) {
    const target = await this.resolveSandboxPath(baseDir, requestedPath, {
      allowMissing: false
    });
    await this.assertWritablePath(baseDir, target.relativePath);
    await rm(target.targetPath, { recursive: true, force: true });
    return { path: toDisplayPath(target.relativePath) };
  }

  async archive(baseDir: string, requestedPath: string) {
    const target = await this.resolveSandboxPath(baseDir, requestedPath, {
      allowMissing: false
    });
    await this.assertWritablePath(baseDir, target.relativePath);
    const archiveRelative = buildArchivePath(target.relativePath);
    const archive = await this.resolveSandboxPath(baseDir, archiveRelative, { allowMissing: true });
    await execFileAsync("zip", ["-r", archive.targetPath, basename(target.targetPath)], {
      cwd: dirname(target.targetPath),
      maxBuffer: 20 * 1024 * 1024
    });
    return { path: toDisplayPath(archive.relativePath) };
  }

  async extract(baseDir: string, requestedPath: string) {
    const archive = await this.resolveSandboxPath(baseDir, requestedPath, {
      allowMissing: false
    });
    await this.assertWritablePath(baseDir, archive.relativePath);
    await execFileAsync("unzip", ["-o", archive.targetPath, "-d", dirname(archive.targetPath)], {
      maxBuffer: 20 * 1024 * 1024
    });
    return { path: toDisplayPath(archive.relativePath) };
  }

  async ensureServerDataDir(baseDir: string) {
    await mkdir(baseDir, { recursive: true });
  }

  private async assertEditableFile(targetPath: string) {
    const fileStats = await lstat(targetPath);
    if (fileStats.isSymbolicLink()) {
      throw new Error("Symlink access is not allowed.");
    }
    if (!fileStats.isFile()) {
      throw new Error("Path is not a file.");
    }
    const base = basename(targetPath).toLowerCase();
    if (FORBIDDEN_BASENAMES.has(base) || base.includes("token") || base.includes("secret")) {
      throw new Error("Access to this file is forbidden.");
    }
  }

  private async assertWritablePath(baseDir: string, relativePath: string) {
    const normalized = normalizeRelativePath(relativePath);
    if (normalized === ".") {
      throw new Error("Root path is not writable.");
    }
    const base = basename(normalized).toLowerCase();
    if (FORBIDDEN_BASENAMES.has(base) || base.includes("token") || base.includes("secret")) {
      throw new Error("Access to this file is forbidden.");
    }

    const parentRelative = dirname(normalized) === "." ? "." : dirname(normalized);
    const parent = await this.resolveSandboxPath(baseDir, parentRelative, {
      allowMissing: false,
      allowRoot: true
    });
    const parentRealPath = await realpath(parent.targetPath);
    const baseRealPath = await realpath(baseDir);
    if (!parentRealPath.startsWith(baseRealPath)) {
      throw new Error("Path escapes the server data directory.");
    }
  }

  private async resolveSandboxPath(
    baseDir: string,
    requestedPath: string,
    options: { allowMissing?: boolean; allowRoot?: boolean } = {}
  ) {
    await this.ensureServerDataDir(baseDir);
    const baseRealPath = await realpath(baseDir);
    const relativePath = normalizeRelativePath(requestedPath);
    if (!options.allowRoot && relativePath === ".") {
      throw new Error("Root path is not allowed for this operation.");
    }

    const joinedPath = resolvePath(baseRealPath, relativePath);
    if (!joinedPath.startsWith(baseRealPath)) {
      throw new Error("Path traversal is not allowed.");
    }

    try {
      const realTarget = await realpath(joinedPath);
      if (!realTarget.startsWith(baseRealPath)) {
        throw new Error("Symlink escape is not allowed.");
      }
      return { relativePath, targetPath: joinedPath };
    } catch (error) {
      if (options.allowMissing) {
        const parent = dirname(joinedPath);
        const realParent = await realpath(parent);
        if (!realParent.startsWith(baseRealPath)) {
          throw new Error("Symlink escape is not allowed.");
        }
        return { relativePath, targetPath: joinedPath };
      }
      throw error;
    }
  }
}

function normalizeRelativePath(input: string) {
  const raw = input ?? "";
  if (raw.includes("\0")) {
    throw new Error("Path contains invalid null bytes.");
  }
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "." || trimmed === "/") {
    return ".";
  }
  const sanitized = trimmed.replace(/\\/g, "/");
  if (sanitized.startsWith("/")) {
    throw new Error("Absolute paths are not allowed.");
  }
  const normalized = normalize(sanitized);
  if (normalized.startsWith("../") || normalized === ".." || normalized.includes("/../")) {
    throw new Error("Path traversal is not allowed.");
  }
  if (normalized.startsWith("/") || normalized === "") {
    throw new Error("Absolute paths are not allowed.");
  }
  return normalized === "." ? "." : normalized.replace(/^\.\/+/, "");
}

function looksBinary(buffer: Buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 1024));
  for (const byte of sample) {
    if (byte === 0) return true;
  }
  return false;
}

function buildArchivePath(relativePath: string) {
  const normalized = normalizeRelativePath(relativePath);
  const base = normalized === "." ? "archive" : basename(normalized);
  const parent = dirname(normalized) === "." ? "." : dirname(normalized);
  return normalizeRelativePath(join(parent, `${base}.zip`).replace(/\\/g, "/"));
}

function toDisplayPath(relativePath: string) {
  return relativePath === "." ? "/" : relativePath;
}

function joinSandboxPath(base: string, name: string) {
  return normalizeRelativePath(base === "." ? name : join(base, name).replace(/\\/g, "/"));
}
