"use client";

import { FormEvent, useState } from "react";
import { adminApi } from "@/lib/api/admin-api";
import type { CompanyWorkload, CreateWorkloadPayload, WorkloadPortProtocol } from "@/types/admin";
import { ActionButton } from "@/components/ui/ActionButton";

const initialForm = {
  name: "",
  type: "container",
  image: "",
  requestedCpu: "1",
  requestedRamMb: "512",
  requestedDiskGb: "10",
  portsText: "",
  configText: "{\n  \n}"
} as const;

type FormState = {
  name: string;
  type: CreateWorkloadPayload["type"];
  image: string;
  requestedCpu: string;
  requestedRamMb: string;
  requestedDiskGb: string;
  portsText: string;
  configText: string;
};

export function CreateWorkloadPanel({
  onCreated
}: {
  onCreated: (workload: CompanyWorkload) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ ...initialForm });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const payload = parseForm(form);
      const result = await adminApi.createWorkload(payload);
      onCreated(result.workload);
      setForm({ ...initialForm });
      setMessage(
        result.placed
          ? "Workload created and assigned to a node."
          : `Workload created without placement: ${result.reason ?? "pending scheduler"}`
      );
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create workload");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-3xl border border-line bg-panel/70 p-5 shadow-soft">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-white">Create workload</p>
          <p className="mt-1 text-sm text-slate-500">
            Register a new runtime workload with image, resources, ports and JSON config.
          </p>
        </div>
        <ActionButton onClick={() => setOpen((value) => !value)}>
          {open ? "Close" : "Create workload"}
        </ActionButton>
      </div>

      {open ? (
        <form onSubmit={submit} className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="block text-sm text-slate-400">
            Name
            <input
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm text-white outline-none focus:border-accent/40"
            />
          </label>

          <label className="block text-sm text-slate-400">
            Type
            <select
              value={form.type}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  type: event.target.value as CreateWorkloadPayload["type"]
                }))
              }
              className="mt-2 w-full rounded-2xl border border-white/10 bg-obsidian px-4 py-3 text-sm text-white outline-none focus:border-accent/40"
            >
              <option value="container">Container</option>
              <option value="minecraft">Minecraft</option>
              <option value="discord-bot">Discord Bot</option>
              <option value="proxy">Proxy</option>
            </select>
          </label>

          <label className="block text-sm text-slate-400 md:col-span-2 xl:col-span-2">
            Image
            <input
              value={form.image}
              onChange={(event) => setForm((current) => ({ ...current, image: event.target.value }))}
              placeholder="ghcr.io/acme/service:latest"
              className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm text-white outline-none focus:border-accent/40"
            />
          </label>

          <label className="block text-sm text-slate-400">
            CPU
            <input
              value={form.requestedCpu}
              onChange={(event) =>
                setForm((current) => ({ ...current, requestedCpu: event.target.value }))
              }
              className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm text-white outline-none focus:border-accent/40"
            />
          </label>

          <label className="block text-sm text-slate-400">
            RAM (MB)
            <input
              value={form.requestedRamMb}
              onChange={(event) =>
                setForm((current) => ({ ...current, requestedRamMb: event.target.value }))
              }
              className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm text-white outline-none focus:border-accent/40"
            />
          </label>

          <label className="block text-sm text-slate-400">
            Disk (GB)
            <input
              value={form.requestedDiskGb}
              onChange={(event) =>
                setForm((current) => ({ ...current, requestedDiskGb: event.target.value }))
              }
              className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm text-white outline-none focus:border-accent/40"
            />
          </label>

          <label className="block text-sm text-slate-400 md:col-span-2 xl:col-span-4">
            Ports
            <textarea
              value={form.portsText}
              onChange={(event) =>
                setForm((current) => ({ ...current, portsText: event.target.value }))
              }
              rows={3}
              placeholder={"25565/tcp\n8080/tcp\n19132/udp"}
              className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm text-white outline-none focus:border-accent/40"
            />
            <p className="mt-2 text-xs text-slate-500">
              One port per line in the format `internalPort/protocol`. Protocol defaults to `tcp`.
            </p>
          </label>

          <label className="block text-sm text-slate-400 md:col-span-2 xl:col-span-4">
            Config JSON
            <textarea
              value={form.configText}
              onChange={(event) =>
                setForm((current) => ({ ...current, configText: event.target.value }))
              }
              rows={10}
              className="mt-2 w-full rounded-2xl border border-white/10 bg-obsidian px-4 py-3 font-mono text-sm text-white outline-none focus:border-accent/40"
            />
          </label>

          <div className="md:col-span-2 xl:col-span-4">
            <ActionButton disabled={busy} type="submit">
              {busy ? "Creating..." : "Create workload"}
            </ActionButton>
          </div>

          {error ? <p className="md:col-span-2 xl:col-span-4 text-sm text-red-200">{error}</p> : null}
          {message ? (
            <p className="md:col-span-2 xl:col-span-4 text-sm text-slate-300">{message}</p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}

function parseForm(form: FormState): CreateWorkloadPayload {
  let parsedConfig: Record<string, unknown> | undefined = undefined;
  const trimmedConfig = form.configText.trim();

  if (trimmedConfig) {
    const maybeConfig = JSON.parse(trimmedConfig) as unknown;
    if (!maybeConfig || Array.isArray(maybeConfig) || typeof maybeConfig !== "object") {
      throw new Error("Config JSON must be an object.");
    }
    parsedConfig = maybeConfig as Record<string, unknown>;
  }

  const ports = form.portsText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parsePortLine(line));

  return {
    name: form.name.trim(),
    type: form.type,
    image: form.image.trim(),
    requestedCpu: Number(form.requestedCpu),
    requestedRamMb: Number(form.requestedRamMb),
    requestedDiskGb: Number(form.requestedDiskGb),
    ...(ports.length > 0 ? { ports } : {}),
    ...(parsedConfig ? { config: parsedConfig } : {})
  };
}

function parsePortLine(line: string): { internalPort: number; protocol?: WorkloadPortProtocol } {
  const [portText, protocolText] = line.split("/");
  const internalPort = Number(portText);

  if (!Number.isInteger(internalPort) || internalPort < 1 || internalPort > 65535) {
    throw new Error(`Invalid port: ${line}`);
  }

  const protocol = (protocolText?.trim().toLowerCase() || "tcp") as WorkloadPortProtocol;
  if (protocol !== "tcp" && protocol !== "udp") {
    throw new Error(`Invalid protocol for port: ${line}`);
  }

  return { internalPort, protocol };
}
