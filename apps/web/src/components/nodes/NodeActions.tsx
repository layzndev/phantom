"use client";

import { useState } from "react";
import { KeyRound, SquarePen, Wrench } from "lucide-react";
import { adminApi } from "@/lib/api/admin-api";
import type { AdminRole, CompanyNode } from "@/types/admin";
import { ActionButton } from "@/components/ui/ActionButton";
import { ActionBar } from "@/components/ui/ActionBar";
import { EditNodeModal } from "./EditNodeModal";

const EDITABLE_ROLES: ReadonlyArray<AdminRole> = ["superadmin", "ops"];

type NodeActionsProps = {
  node: CompanyNode;
  onUpdated?: (node: CompanyNode) => void;
  adminRole?: AdminRole | null;
  compact?: boolean;
};

export function NodeActions({ node, onUpdated, adminRole = null, compact = false }: NodeActionsProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  async function run(label: string, action: () => Promise<{ node?: CompanyNode } | unknown>) {
    setBusy(label);
    setMessage(null);
    setToken(null);

    try {
      const result = await action();

      if (result && typeof result === "object" && "node" in result && result.node) {
        onUpdated?.(result.node as CompanyNode);
      }

      if (
        result &&
        typeof result === "object" &&
        "rotation" in result &&
        result.rotation &&
        typeof result.rotation === "object" &&
        "token" in result.rotation
      ) {
        setToken(String(result.rotation.token));
      }

      setMessage(`${label} accepted`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  const canEdit = adminRole !== null && EDITABLE_ROLES.includes(adminRole);

  if (compact) {
    const iconButtonClass =
      "h-10 w-10 rounded-xl p-0 text-slate-200 hover:border-accent/40 hover:bg-accent/[0.08] hover:text-white";

    return (
      <div className="space-y-2">
        <ActionBar className="flex items-center gap-2 rounded-none border-0 bg-transparent p-0">
          {canEdit ? (
            <ActionButton
              title="Edit node"
              aria-label="Edit node"
              className={iconButtonClass}
              disabled={Boolean(busy)}
              onClick={() => setEditing(true)}
            >
              <SquarePen className="h-5 w-5 shrink-0" strokeWidth={2.6} />
            </ActionButton>
          ) : null}

          <ActionButton
            title={node.maintenanceMode ? "Disable maintenance" : "Enable maintenance"}
            aria-label={node.maintenanceMode ? "Disable maintenance" : "Enable maintenance"}
            className={iconButtonClass}
            disabled={Boolean(busy)}
            onClick={() => run("maintenance", () => adminApi.maintenanceNode(node.id, !node.maintenanceMode))}
          >
            <Wrench className="h-5 w-5 shrink-0" strokeWidth={2.6} />
          </ActionButton>

          <ActionButton
            title="Rotate node token"
            aria-label="Rotate node token"
            className={iconButtonClass}
            disabled={Boolean(busy)}
            onClick={() => run("rotate token", () => adminApi.rotateNodeToken(node.id))}
          >
            <KeyRound className="h-5 w-5 shrink-0" strokeWidth={2.6} />
          </ActionButton>
        </ActionBar>

        {token ? (
          <div className="rounded-2xl border border-amber/25 bg-amber/[0.08] p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber">Token shown once</p>
            <p className="mt-2 break-all font-mono text-xs text-slate-100">{token}</p>
          </div>
        ) : null}

        {editing ? (
          <EditNodeModal
            node={node}
            onClose={() => setEditing(false)}
            onUpdated={(updated) => {
              onUpdated?.(updated);
              setMessage("edit saved");
            }}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ActionBar>
        {canEdit ? (
          <ActionButton disabled={Boolean(busy)} onClick={() => setEditing(true)}>
            <SquarePen size={16} />
            Edit
          </ActionButton>
        ) : null}

        <ActionButton
          disabled={Boolean(busy)}
          onClick={() => run("maintenance", () => adminApi.maintenanceNode(node.id, !node.maintenanceMode))}
        >
          <Wrench size={16} />
          {node.maintenanceMode ? "Maintenance off" : "Maintenance on"}
        </ActionButton>

        <ActionButton disabled={Boolean(busy)} onClick={() => run("rotate token", () => adminApi.rotateNodeToken(node.id))}>
          <KeyRound size={16} />
          Rotate token
        </ActionButton>
      </ActionBar>

      {message ? <p className="text-sm text-slate-400">{message}</p> : null}

      {token ? (
        <div className="rounded-2xl border border-amber/25 bg-amber/[0.08] p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber">Token shown once</p>
          <p className="mt-2 break-all font-mono text-xs text-slate-100">{token}</p>
        </div>
      ) : null}

      {editing ? (
        <EditNodeModal
          node={node}
          onClose={() => setEditing(false)}
          onUpdated={(updated) => {
            onUpdated?.(updated);
            setMessage("edit saved");
          }}
        />
      ) : null}
    </div>
  );
}