"use client";

import { Plus, Shield, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { adminApi } from "@/lib/api/admin-api";

const CIDR_REGEX =
  /^(?:(?:\d{1,3}\.){3}\d{1,3}|[a-fA-F0-9:]+)(?:\/\d{1,3})?$/;

export function IpAllowlistCard() {
  const [entries, setEntries] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void adminApi
      .me()
      .then((response) => {
        if (cancelled) return;
        setEntries(response.admin.ipAllowlist ?? []);
      })
      .catch((meError) => {
        if (cancelled) return;
        setError(meError instanceof Error ? meError.message : "Unable to load profile.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = async (next: string[]) => {
    setSaving(true);
    setError(null);
    try {
      const response = await adminApi.updateAdminIpAllowlist(next);
      setEntries(response.admin.ipAllowlist);
      setSavedAt(Date.now());
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to update allowlist.");
    } finally {
      setSaving(false);
    }
  };

  const addEntry = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (!CIDR_REGEX.test(trimmed)) {
      setError("Entries must be IPv4, IPv6 or CIDR notation (eg. 203.0.113.5 or 10.0.0.0/8).");
      return;
    }
    if (entries.includes(trimmed)) {
      setDraft("");
      return;
    }
    setDraft("");
    void persist([...entries, trimmed]);
  };

  const removeEntry = (index: number) => {
    void persist(entries.filter((_, idx) => idx !== index));
  };

  const clearAll = () => {
    if (entries.length === 0) return;
    if (!window.confirm("Clear the allowlist? Your account will accept logins from any IP again.")) return;
    void persist([]);
  };

  return (
    <section className="rounded-2xl border border-line bg-panel/78 p-5 shadow-soft">
      <header className="flex items-start gap-3">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-400/30 bg-emerald-400/[0.08] text-emerald-200">
          <Shield className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white">IP allowlist</h3>
          <p className="mt-1 text-xs text-slate-400">
            Restrict your account to specific IPs or CIDR ranges. The list is enforced at
            login and on every authenticated request — adding entries that exclude your
            current IP is refused so you can't lock yourself out.
          </p>
        </div>
      </header>

      {loading ? (
        <p className="mt-5 text-sm text-slate-500">Loading…</p>
      ) : (
        <>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addEntry();
                }
              }}
              placeholder="203.0.113.5 or 10.0.0.0/8 or 2001:db8::/32"
              disabled={saving}
              className="h-9 flex-1 rounded-lg border border-white/10 bg-obsidian px-3 text-xs text-slate-200 outline-none focus:border-accent/40 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={addEntry}
              disabled={saving || draft.trim().length === 0}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.08] px-3 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/[0.14] disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" /> Add
            </button>
            {entries.length > 0 ? (
              <button
                type="button"
                onClick={clearAll}
                disabled={saving}
                className="inline-flex h-9 items-center rounded-lg border border-white/10 bg-white/[0.05] px-3 text-xs text-slate-300 transition hover:bg-white/[0.08] disabled:opacity-40"
              >
                Clear all
              </button>
            ) : null}
          </div>

          {error ? <p className="mt-3 text-xs text-red-300">{error}</p> : null}
          {savedAt ? <p className="mt-3 text-xs text-emerald-300">Saved.</p> : null}

          <div className="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-obsidian/60">
            {entries.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-500">
                No entries — your account currently accepts logins from any IP.
              </p>
            ) : (
              <ul className="divide-y divide-white/[0.04]">
                {entries.map((entry, index) => (
                  <li
                    key={`${entry}-${index}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 text-xs"
                  >
                    <span className="font-mono text-slate-100">{entry}</span>
                    <button
                      type="button"
                      onClick={() => removeEntry(index)}
                      disabled={saving}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-500/[0.1] hover:text-red-300 disabled:opacity-40"
                      aria-label="Remove entry"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="mt-4 text-[11px] text-slate-500">
            Tip: pair this with the global <span className="font-mono text-slate-300">ADMIN_IP_ALLOWLIST</span> env
            for two layers of network defense.
          </p>
        </>
      )}
    </section>
  );
}
