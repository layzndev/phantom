"use client";

import { useState } from "react";
import { KeyRound, SquarePen, Trash2, Wrench } from "lucide-react";
import { adminApi } from "@/lib/api/admin-api";
import type { AdminRole, CompanyNode } from "@/types/admin";
import { ActionButton } from "@/components/ui/ActionButton";
import { ActionBar } from "@/components/ui/ActionBar";
import { EditNodeModal } from "./EditNodeModal";

const EDITABLE_ROLES: ReadonlyArray<AdminRole> = ["superadmin", "ops"];
const DELETABLE_ROLES: ReadonlyArray<AdminRole> = ["superadmin"];

type NodeActionsProps = {
  node: CompanyNode;
  onUpdated?: (node: CompanyNode) => void;
  onRemoved?: (nodeId: string) => void;
  adminRole?: AdminRole | null;
  compact?: boolean;
};

export function NodeActions({
  node,
  onUpdated,
  onRemoved,
  adminRole = null,
  compact = false
}: NodeActionsProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

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

  async function handleDelete() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      setMessage("Click delete again to confirm");
      return;
    }
    setBusy("delete");
    setMessage(null);
    try {
      await adminApi.deleteNode(node.id);
      onRemoved?.(node.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Delete failed");
      setConfirmingDelete(false);
    } finally {
      setBusy(null);
    }
  }

  const canEdit = adminRole !== null && EDITABLE_ROLES.includes(adminRole);
  const canDelete = adminRole !== null && DELETABLE_ROLES.includes(adminRole);

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

          {canDelete ? (
            <ActionButton
              title={confirmingDelete ? "Confirm delete" : "Delete node"}
              aria-label={confirmingDelete ? "Confirm delete" : "Delete node"}
              className={
                confirmingDelete
                  ? "h-10 w-10 rounded-xl border-red-500/55 bg-red-500/15 p-0 text-red-100 hover:border-red-500/70 hover:bg-red-500/25 hover:text-white"
                  : "h-10 w-10 rounded-xl border-red-500/25 p-0 text-red-300 hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-200"
              }
              disabled={Boolean(busy)}
              onClick={handleDelete}
            >
              <Trash2 className="h-5 w-5 shrink-0" strokeWidth={2.6} />
            </ActionButton>
          ) : null}
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
        {canDelete ? (
          <ActionButton
            disabled={Boolean(busy)}
            onClick={handleDelete}
            className={
              confirmingDelete
                ? "border-red-500/50 bg-red-500/15 text-red-200 hover:border-red-500/60 hover:bg-red-500/25 hover:text-red-100"
                : "border-red-500/25 text-red-300 hover:border-red-500/45 hover:bg-red-500/10 hover:text-red-200"
            }
          >
            {busy === "delete" ? "Deleting..." : confirmingDelete ? "Confirm delete" : "Delete"}
          </ActionButton>
        ) : null}
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