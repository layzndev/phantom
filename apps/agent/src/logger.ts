import type { LogLevel } from "./types.js";

const levelRank: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

export class Logger {
  constructor(
    private readonly level: LogLevel,
    private readonly prefix = "phantom-agent"
  ) {}

  debug(message: string, metadata?: Record<string, unknown>) {
    this.write("debug", message, metadata);
  }

  info(message: string, metadata?: Record<string, unknown>) {
    this.write("info", message, metadata);
  }

  warn(message: string, metadata?: Record<string, unknown>) {
    this.write("warn", message, metadata);
  }

  error(message: string, metadata?: Record<string, unknown>) {
    this.write("error", message, metadata);
  }

  child(scope: string) {
    return new Logger(this.level, `${this.prefix}:${scope}`);
  }

  private write(level: LogLevel, message: string, metadata?: Record<string, unknown>) {
    if (levelRank[level] < levelRank[this.level]) {
      return;
    }

    const timestamp = new Date().toISOString();
    const metaText = metadata ? ` ${JSON.stringify(redactSecrets(metadata))}` : "";
    const line = `[${timestamp}] ${this.prefix} ${level.toUpperCase()} ${message}${metaText}`;

    if (level === "error" || level === "warn") {
      console.error(line);
      return;
    }

    console.log(line);
  }
}

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSecrets);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, innerValue]) => {
      if (key.toLowerCase().includes("token")) {
        return [key, "[redacted]"];
      }

      return [key, redactSecrets(innerValue)];
    })
  );
}
