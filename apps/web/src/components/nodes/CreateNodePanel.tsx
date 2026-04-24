"use client";

import { FormEvent, useState } from "react";
import { adminApi } from "@/lib/api/admin-api";
import type { CompanyNode, CreateNodePayload } from "@/types/admin";
import { ActionButton } from "@/components/ui/ActionButton";

const initialForm: CreateNodePayload = {
  id: "",
  name: "",
  provider: "",
  region: "",
  internalHost: "",
  publicHost: "",
  runtimeMode: "remote",
  portRangeStart: 25000,
  portRangeEnd: 26000
};

export function CreateNodePanel({ onCreated }: { onCreated: (node: CompanyNode) => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<CreateNodePayload>(initialForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setToken(null);

    try {
      const result = await adminApi.createNode(form);
      onCreated(result.node);
      setToken(result.token);
      setForm(initialForm);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create node");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-3xl border border-line bg-panel/70 p-5 shadow-soft">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-white">Register node</p>
          <p className="mt-1 text-sm text-slate-500">Create a Phantom registry node and generate its runtime token.</p>
        </div>
        <ActionButton onClick={() => setOpen((value) => !value)}>{open ? "Close" : "Create node"}</ActionButton>
      </div>

      {open ? (
        <form onSubmit={submit} className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            ["id", "Node ID"],
            ["name", "Name"],
            ["provider", "Provider"],
            ["region", "Region"],
            ["internalHost", "Internal host"],
            ["publicHost", "Public host"]
          ].map(([key, label]) => (
            <label key={key} className="block text-sm text-slate-400">
              {label}
              <input
                value={String(form[key as keyof CreateNodePayload])}
                onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
                className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm text-white outline-none focus:border-accent/40"
              />
            </label>
          ))}
          <label className="block text-sm text-slate-400">
            Runtime
            <select
              value={form.runtimeMode}
              onChange={(event) => setForm((current) => ({ ...current, runtimeMode: event.target.value as "local" | "remote" }))}
              className="mt-2 w-full rounded-2xl border border-white/10 bg-obsidian px-4 py-3 text-sm text-white outline-none focus:border-accent/40"
            >
              <option value="remote">Remote</option>
              <option value="local">Local</option>
            </select>
          </label>
          {[
            ["portRangeStart", "Port start"],
            ["portRangeEnd", "Port end"]
          ].map(([key, label]) => (
            <label key={key} className="block text-sm text-slate-400">
              {label}
              <input
                type="number"
                value={Number(form[key as keyof CreateNodePayload])}
                onChange={(event) => setForm((current) => ({ ...current, [key]: Number(event.target.value) }))}
                className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm text-white outline-none focus:border-accent/40"
              />
            </label>
          ))}
          <p className="md:col-span-2 xl:col-span-4 rounded-2xl border border-white/5 bg-white/[0.025] px-4 py-3 text-xs text-slate-400">
            RAM and CPU are detected automatically from the first heartbeat sent by the node runtime.
          </p>
          <div className="md:col-span-2 xl:col-span-4">
            <ActionButton disabled={busy} type="submit">{busy ? "Creating..." : "Create node and token"}</ActionButton>
          </div>
          {error ? <p className="md:col-span-2 xl:col-span-4 text-sm text-red-200">{error}</p> : null}
          {token ? (
            <div className="md:col-span-2 xl:col-span-4 rounded-2xl border border-amber/25 bg-amber/[0.08] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber">Token shown once</p>
              <p className="mt-2 break-all font-mono text-xs text-slate-100">{token}</p>
            </div>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
