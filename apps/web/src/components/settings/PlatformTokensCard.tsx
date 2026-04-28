"use client";

import { Copy, Key, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { adminApi } from "@/lib/api/admin-api";
import { formatDateTime } from "@/lib/utils/format";
import type { PlatformTokenIssued, PlatformTokenSummary } from "@/types/admin";

export function PlatformTokensCard() {
  const [tokens, setTokens] = useState<PlatformTokenSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [reveal, setReveal] = useState<PlatformTokenIssued | null>(null);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    try {
      const result = await adminApi.listPlatformTokens();
      setTokens(result.tokens);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load platform tokens.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const issue = async () => {
    const name = draft.trim();
    if (!name) return;
    setBusy("issue");
    try {
      const result = await adminApi.issuePlatformToken({ name });
      setReveal(result.token);
      setDraft("");
      await load();
    } catch (issueError) {
      setError(issueError instanceof Error ? issueError.message : "Unable to issue token.");
    } finally {
      setBusy(null);
    }
  };

  const revoke = async (id: string, label: string) => {
    if (!window.confirm(`Revoke ${label}? This token will stop working immediately.`)) return;
    setBusy(id);
    try {
      await adminApi.revokePlatformToken(id);
      await load();
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : "Unable to revoke token.");
    } finally {
      setBusy(null);
    }
  };

  const copyToken = async () => {
    if (!reveal) return;
    try {
      await navigator.clipboard.writeText(reveal.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore — user can copy manually
    }
  };

  return (
    <section className="rounded-2xl border border-line bg-panel/78 p-5 shadow-soft">
      <header className="flex items-start gap-3">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-400/30 bg-cyan-400/[0.08] text-cyan-200">
          <Key className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white">Platform tokens</h3>
          <p className="mt-1 text-xs text-slate-400">
            Machine-to-machine bearer tokens used by the Hosting backend (Nebula) to call
            <span className="mx-1 rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-slate-200">
              /platform/*
            </span>
            on Phantom. Tokens are shown <strong>once</strong> at creation — store them in a
            secret manager. Revoking a token disables it immediately.
          </p>
        </div>
      </header>

      {reveal ? (
        <div className="mt-5 rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.08] p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-200">
            New token — copy now, you won't see it again
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <code className="break-all rounded-lg bg-obsidian px-3 py-2 font-mono text-xs text-emerald-200">
              {reveal.token}
            </code>
            <button
              type="button"
              onClick={copyToken}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.05] px-3 text-xs text-white transition hover:bg-white/[0.08]"
            >
              <Copy className="h-3.5 w-3.5" /> {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              onClick={() => setReveal(null)}
              className="inline-flex h-9 items-center rounded-lg border border-white/10 bg-white/[0.05] px-3 text-xs text-slate-300 transition hover:bg-white/[0.08]"
            >
              I've stored it
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void issue();
            }
          }}
          placeholder="Token name (eg. nebula-production)"
          disabled={busy === "issue"}
          className="h-9 flex-1 rounded-lg border border-white/10 bg-obsidian px-3 text-xs text-slate-200 outline-none focus:border-accent/40 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => void issue()}
          disabled={busy === "issue" || draft.trim().length < 2}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/[0.08] px-3 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-500/[0.14] disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" /> Issue token
        </button>
      </div>

      {error ? <p className="mt-3 text-xs text-red-300">{error}</p> : null}

      <div className="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-obsidian/60">
        {loading && tokens === null ? (
          <p className="px-4 py-6 text-sm text-slate-500">Loading…</p>
        ) : tokens === null || tokens.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500">No tokens yet.</p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="bg-white/[0.03] text-[10px] uppercase tracking-[0.18em] text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Token</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Last used</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {tokens.map((token) => {
                const revoked = Boolean(token.revokedAt);
                const expired = token.expiresAt ? new Date(token.expiresAt) < new Date() : false;
                return (
                  <tr key={token.id} className={revoked ? "opacity-60" : ""}>
                    <td className="px-4 py-3 font-semibold text-white">{token.name}</td>
                    <td className="px-4 py-3 font-mono text-slate-300">
                      {token.prefix}…{token.last4}
                    </td>
                    <td className="px-4 py-3 text-slate-400">{formatDateTime(token.createdAt)}</td>
                    <td className="px-4 py-3 text-slate-400">
                      {token.lastUsedAt ? formatDateTime(token.lastUsedAt) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill revoked={revoked} expired={expired} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!revoked ? (
                        <button
                          type="button"
                          onClick={() => void revoke(token.id, token.name)}
                          disabled={busy === token.id}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-500/[0.1] hover:text-red-300 disabled:opacity-40"
                          aria-label={`Revoke ${token.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="mt-4 text-[11px] text-slate-500">
        The Hosting backend authenticates as
        <span className="mx-1 rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-slate-200">
          Authorization: Bearer phs_live_…
        </span>
        on every request. Per-tenant scoping is enforced server-side; tokens themselves are global.
      </p>
    </section>
  );
}

function StatusPill({ revoked, expired }: { revoked: boolean; expired: boolean }) {
  if (revoked) {
    return (
      <span className="inline-flex items-center rounded-md border border-red-500/30 bg-red-500/[0.08] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-200">
        Revoked
      </span>
    );
  }
  if (expired) {
    return (
      <span className="inline-flex items-center rounded-md border border-amber-500/30 bg-amber-500/[0.08] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
        Expired
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-md border border-emerald-500/30 bg-emerald-500/[0.08] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-200">
      Active
    </span>
  );
}
