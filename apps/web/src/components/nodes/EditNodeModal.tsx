"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { adminApi } from "@/lib/api/admin-api";
import type { CompanyNode, RuntimeMode, UpdateNodePayload } from "@/types/admin";
import { ActionButton } from "@/components/ui/ActionButton";

type FormState = {
  name: string;
  provider: string;
  region: string;
  internalHost: string;
  publicHost: string;
  runtimeMode: RuntimeMode;
  totalRamMb: string;
  totalCpu: string;
  portRangeStart: string;
  portRangeEnd: string;
};

function toForm(node: CompanyNode): FormState {
  return {
    name: node.name,
    provider: node.provider,
    region: node.region,
    internalHost: node.internalHost,
    publicHost: node.publicHost,
    runtimeMode: node.runtimeMode,
    totalRamMb: String(node.totalRamMb),
    totalCpu: String(node.totalCpu),
    portRangeStart: String(node.portRangeStart),
    portRangeEnd: String(node.portRangeEnd)
  };
}

function diffPayload(initial: FormState, current: FormState): UpdateNodePayload {
  const payload: UpdateNodePayload = {};
  const stringKeys: Array<keyof Pick<FormState, "name" | "provider" | "region" | "internalHost" | "publicHost">> = [
    "name",
    "provider",
    "region",
    "internalHost",
    "publicHost"
  ];
  for (const key of stringKeys) {
    if (initial[key].trim() !== current[key].trim()) {
      payload[key] = current[key].trim();
    }
  }
  if (initial.runtimeMode !== current.runtimeMode) {
    payload.runtimeMode = current.runtimeMode;
  }
  const numberKeys: Array<keyof Pick<FormState, "totalRamMb" | "totalCpu" | "portRangeStart" | "portRangeEnd">> = [
    "totalRamMb",
    "totalCpu",
    "portRangeStart",
    "portRangeEnd"
  ];
  for (const key of numberKeys) {
    if (initial[key] !== current[key]) {
      const parsed = Number(current[key]);
      if (Number.isFinite(parsed)) {
        payload[key] = parsed;
      }
    }
  }
  return payload;
}

export function EditNodeModal({
  node,
  onClose,
  onUpdated
}: {
  node: CompanyNode;
  onClose: () => void;
  onUpdated: (node: CompanyNode) => void;
}) {
  const [initial] = useState<FormState>(() => toForm(node));
  const [form, setForm] = useState<FormState>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  const payload = diffPayload(initial, form);
  const isDirty = Object.keys(payload).length > 0;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isDirty || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { node: updated } = await adminApi.updateNode(node.id, payload);
      onUpdated(updated);
      onClose();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update node.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-node-title"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-3xl rounded-3xl border border-line bg-panel/95 p-6 shadow-soft outline-none"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Edit node</p>
            <h2 id="edit-node-title" className="mt-1 text-xl font-semibold text-white">
              {node.name}
            </h2>
            <p className="mt-1 font-mono text-xs text-slate-500">{node.id}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-sm text-slate-500 transition hover:text-white disabled:opacity-50"
            aria-label="Close"
          >
            Close
          </button>
        </div>

        <form onSubmit={submit} className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[
            ["name", "Name"],
            ["provider", "Provider"],
            ["region", "Region"],
            ["internalHost", "Internal host"],
            ["publicHost", "Public host"]
          ].map(([key, label]) => (
            <label key={key} className="block text-sm text-slate-400">
              {label}
              <input
                value={form[key as keyof FormState] as string}
                onChange={(event) => set(key as keyof FormState, event.target.value as FormState[keyof FormState])}
                disabled={busy}
                className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm text-white outline-none transition focus:border-accent/40 disabled:opacity-60"
              />
            </label>
          ))}

          <label className="block text-sm text-slate-400">
            Runtime
            <select
              value={form.runtimeMode}
              onChange={(event) => set("runtimeMode", event.target.value as RuntimeMode)}
              disabled={busy}
              className="mt-2 w-full rounded-2xl border border-white/10 bg-obsidian px-4 py-3 text-sm text-white outline-none focus:border-accent/40 disabled:opacity-60"
            >
              <option value="remote">Remote</option>
              <option value="local">Local</option>
            </select>
          </label>

          {[
            ["totalRamMb", "RAM MB"],
            ["totalCpu", "CPU"],
            ["portRangeStart", "Port start"],
            ["portRangeEnd", "Port end"]
          ].map(([key, label]) => (
            <label key={key} className="block text-sm text-slate-400">
              {label}
              <input
                type="number"
                value={form[key as keyof FormState] as string}
                onChange={(event) => set(key as keyof FormState, event.target.value as FormState[keyof FormState])}
                disabled={busy}
                className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm text-white outline-none transition focus:border-accent/40 disabled:opacity-60"
              />
            </label>
          ))}

          <div className="md:col-span-2 xl:col-span-3 mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <p className="text-xs text-slate-500">
              {isDirty
                ? `${Object.keys(payload).length} field(s) will be updated.`
                : "No changes yet."}
            </p>
            <div className="flex gap-2">
              <ActionButton type="button" onClick={onClose} disabled={busy}>
                Cancel
              </ActionButton>
              <ActionButton type="submit" disabled={!isDirty || busy}>
                {busy ? "Saving..." : "Save changes"}
              </ActionButton>
            </div>
          </div>

          {error ? (
            <p className="md:col-span-2 xl:col-span-3 rounded-2xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-100">
              {error}
            </p>
          ) : null}
        </form>
      </div>
    </div>
  );
}
