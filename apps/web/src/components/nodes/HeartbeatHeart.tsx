import { formatDateTime } from "@/lib/utils/format";

const FRESH_MS = 60_000;
const STALE_MS = 5 * 60_000;

type Tone = "fresh" | "stale" | "cold" | "missing";

function toneFor(heartbeat: string | null): Tone {
  if (!heartbeat) return "missing";
  const age = Date.now() - new Date(heartbeat).getTime();
  if (!Number.isFinite(age) || age < 0) return "missing";
  if (age < FRESH_MS) return "fresh";
  if (age < STALE_MS) return "stale";
  return "cold";
}

const TONE_CLASS: Record<Tone, string> = {
  fresh: "text-emerald-400",
  stale: "text-amber-400",
  cold: "text-red-400",
  missing: "text-slate-600"
};

const TONE_LABEL: Record<Tone, string> = {
  fresh: "Heartbeat fresh",
  stale: "Heartbeat stale",
  cold: "Heartbeat cold",
  missing: "No heartbeat yet"
};

export function HeartbeatHeart({ heartbeat }: { heartbeat: string | null }) {
  const tone = toneFor(heartbeat);
  const formatted = heartbeat ? formatDateTime(heartbeat) : "No heartbeat";
  const title = `${TONE_LABEL[tone]} - ${formatted}`;

  return (
    <span
      className={`inline-flex items-center ${TONE_CLASS[tone]}`}
      title={title}
      aria-label={title}
      role="img"
    >
      <svg
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M12 21s-6.716-4.273-9.193-8.06C1.17 10.198 1.993 6.5 5.1 5.34c2.2-.82 4.2.06 5.4 1.67.3.4.9.4 1.2 0 1.2-1.61 3.2-2.49 5.4-1.67 3.107 1.16 3.93 4.858 2.293 7.6C18.716 16.727 12 21 12 21z" />
      </svg>
    </span>
  );
}
