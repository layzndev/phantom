"use client";

import { useEffect, useState } from "react";
import { formatDateTime } from "@/lib/utils/format";
import type { NodeHealth, NodeStatus } from "@/types/admin";

const FRESH_MS = 60_000;
const STALE_MS = 5 * 60_000;
const TICK_MS = 15_000;

type Tone = "fresh" | "stale" | "cold" | "missing";

function toneFor(heartbeat: string | null, status: NodeStatus, health: NodeHealth): Tone {
  if (!heartbeat) return "missing";
  if (status === "offline" || health === "unreachable") return "cold";

  const age = Date.now() - new Date(heartbeat).getTime();

  if (!Number.isFinite(age) || age < 0) return "fresh";
  if (age < FRESH_MS) return "fresh";
  if (age < STALE_MS) return "stale";

  return "cold";
}

const TONE_CLASS: Record<Tone, string> = {
  fresh: "text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.45)]",
  stale: "text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.38)]",
  cold: "text-red-400 drop-shadow-[0_0_8px_rgba(248,113,113,0.35)]",
  missing: "text-slate-600"
};

const TONE_LABEL: Record<Tone, string> = {
  fresh: "Heartbeat fresh",
  stale: "Heartbeat delayed",
  cold: "Node offline",
  missing: "No heartbeat yet"
};

export function HeartbeatHeart({
  heartbeat,
  status,
  health
}: {
  heartbeat: string | null;
  status: NodeStatus;
  health: NodeHealth;
}) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const tone = toneFor(heartbeat, status, health);
  const formatted = heartbeat ? formatDateTime(heartbeat) : "No heartbeat";
  const title = `${TONE_LABEL[tone]} - ${formatted}`;
  const isBroken = tone === "cold" || tone === "missing";

  return (
    <span
      className={`inline-flex items-center justify-center ${TONE_CLASS[tone]}`}
      title={title}
      aria-label={title}
      role="img"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          d="M12 21s-7.2-4.35-9.6-8.55C0.8 9.65 1.35 6.15 4.05 4.55c2.05-1.2 4.55-.7 5.95 1.05L12 8.1l2-2.5c1.4-1.75 3.9-2.25 5.95-1.05 2.7 1.6 3.25 5.1 1.65 7.9C19.2 16.65 12 21 12 21z"
          opacity="0.95"
        />

        {isBroken ? (
          <path
            d="M13.35 4.85 10.75 10h3.15l-3.35 9.1.95-6.15H8.45l2.95-8.1z"
            fill="#050505"
            opacity="0.78"
          />
        ) : (
          <path
            d="M5.4 12.2h2.8l1.1-2.9 2.3 6.15 1.65-4.2h5.1"
            fill="none"
            stroke="#050505"
            strokeWidth="1.65"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.58"
          />
        )}
      </svg>
    </span>
  );
}