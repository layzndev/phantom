"use client";

import { useState } from "react";
import { adminApi } from "@/lib/api/admin-api";
import type { CompanyNode } from "@/types/admin";
import { ActionButton } from "@/components/ui/ActionButton";
import { ActionBar } from "@/components/ui/ActionBar";

export function NodeActions({ node, onUpdated }: { node: CompanyNode; onUpdated?: (node: CompanyNode) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  async function run(label: string, action: () => Promise<{ node?: CompanyNode } | unknown>) {
    setBusy(label);
    setMessage(null);
    setToken(null);
    try {
      const result = await action();
      if (result && typeof result === "object" && "node" in result && result.node) {
        onUpdated?.(result.node as CompanyNode);
      }
      if (result && typeof result === "object" && "rotation" in result && result.rotation && typeof result.rotation === "object" && "token" in result.rotation) {
        setToken(String(result.rotation.token));
      }
      setMessage(`${label} accepted`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <ActionBar>
        <ActionButton disabled={Boolean(busy)} onClick={() => run("maintenance", () => adminApi.maintenanceNode(node.id, !node.maintenanceMode))}>
          {node.maintenanceMode ? "Maintenance off" : "Maintenance on"}
        </ActionButton>
        <ActionButton disabled={Boolean(busy)} onClick={() => run("rotate token", () => adminApi.rotateNodeToken(node.id))}>Rotate token</ActionButton>
      </ActionBar>
      {message ? <p className="text-sm text-slate-400">{message}</p> : null}
      {token ? (
        <div className="rounded-2xl border border-amber/25 bg-amber/[0.08] p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber">Token shown once</p>
          <p className="mt-2 break-all font-mono text-xs text-slate-100">{token}</p>
        </div>
      ) : null}
    </div>
  );
}
