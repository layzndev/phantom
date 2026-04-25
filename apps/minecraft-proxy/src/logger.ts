type Fields = Record<string, unknown> | undefined;

interface ThrottleEntry {
  windowStart: number;
  count: number;
}

const WINDOW_MS = 1_000;
const MAX_PER_WINDOW = 20;
const throttle = new Map<string, ThrottleEntry>();

function shouldEmit(key: string) {
  const now = Date.now();
  const entry = throttle.get(key);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    throttle.set(key, { windowStart: now, count: 1 });
    return true;
  }
  entry.count += 1;
  return entry.count <= MAX_PER_WINDOW;
}

function emit(level: "info" | "warn" | "error", event: string, fields: Fields) {
  if (!shouldEmit(`${level}:${event}`)) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    event,
    ...fields
  };
  const stream = level === "error" ? process.stderr : process.stdout;
  stream.write(`${JSON.stringify(line)}\n`);
}

export const log = {
  info(event: string, fields?: Fields) {
    emit("info", event, fields);
  },
  warn(event: string, fields?: Fields) {
    emit("warn", event, fields);
  },
  error(event: string, fields?: Fields) {
    emit("error", event, fields);
  }
};
