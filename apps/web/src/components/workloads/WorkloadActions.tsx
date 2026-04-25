"use client";

import { useState } from "react";
import { Play, RotateCcw, Skull, Square, Trash2 } from "lucide-react";
import { adminApi } from "@/lib/api/admin-api";
import type { AdminRole, CompanyWorkload } from "@/types/admin";
import { ActionBar } from "@/components/ui/ActionBar";
import { ActionButton } from "@/components/ui/ActionButton";

const OPERABLE_ROLES: ReadonlyArray<AdminRole> = ["superadmin", "ops"];
const KILLABLE_ROLES: ReadonlyArray<AdminRole> = ["superadmin"];
const DELETABLE_ROLES: ReadonlyArray<AdminRole> = ["superadmin"];

type WorkloadActionsProps = {
  workload: CompanyWorkload;
  adminRole?: AdminRole | null;
  onUpdated?: (workload: CompanyWorkload) => void;
  onRemoved?: (workloadId: string) => void;
  compact?: boolean;
};

export function WorkloadActions({
  workload,
  adminRole = null,
  onUpdated,
  onRemoved,
  compact = false
}: WorkloadActionsProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const canOperate = adminRole !== null && OPERABLE_ROLES.includes(adminRole);
  const canKill = adminRole !== null && KILLABLE_ROLES.includes(adminRole);
  const canDelete = adminRole !== null && DELETABLE_ROLES.includes(adminRole);
  const lockedByDelete = workload.status === "deleting";

  async function run(
    label: string,
    action: () => Promise<{ workload?: CompanyWorkload } | unknown>
  ) {
    setBusy(label);
    setMessage(null);

    try {
      const result = await action();
      if (result && typeof result === "object" && "workload" in result && result.workload) {
        onUpdated?.(result.workload as CompanyWorkload);
      }
      setConfirmingDelete(false);
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
      const result = await adminApi.deleteWorkload(workload.id);
      if (result.finalized) {
        onRemoved?.(workload.id);
      } else if (result.workload) {
        onUpdated?.(result.workload);
        setMessage("delete accepted");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Delete failed");
      setConfirmingDelete(false);
    } finally {
      setBusy(null);
    }
  }

  const iconButtonClass =
    "h-10 w-10 rounded-xl p-0 text-slate-200 hover:border-accent/40 hover:bg-accent/[0.08] hover:text-white";

  const buttons = (
    <>
      {canOperate ? (
        <ActionButton
          title="Start workload"
          aria-label="Start workload"
          className={compact ? iconButtonClass : undefined}
          disabled={Boolean(busy) || lockedByDelete}
          onClick={() => run("start", () => adminApi.startWorkload(workload.id))}
        >
          <Play className="h-4 w-4 shrink-0" strokeWidth={2.4} />
          {compact ? null : "Start"}
        </ActionButton>
      ) : null}

      {canOperate ? (
        <ActionButton
          title="Stop workload"
          aria-label="Stop workload"
          className={compact ? iconButtonClass : undefined}
          disabled={Boolean(busy) || lockedByDelete}
          onClick={() => run("stop", () => adminApi.stopWorkload(workload.id))}
        >
          <Square className="h-4 w-4 shrink-0" strokeWidth={2.4} />
          {compact ? null : "Stop"}
        </ActionButton>
      ) : null}

      {canOperate ? (
        <ActionButton
          title="Restart workload"
          aria-label="Restart workload"
          className={compact ? iconButtonClass : undefined}
          disabled={Boolean(busy) || lockedByDelete}
          onClick={() => run("restart", () => adminApi.restartWorkload(workload.id))}
        >
          <RotateCcw className="h-4 w-4 shrink-0" strokeWidth={2.4} />
          {compact ? null : "Restart"}
        </ActionButton>
      ) : null}

      {canKill ? (
        <ActionButton
          title="Kill workload"
          aria-label="Kill workload"
          className={
            compact
              ? `${iconButtonClass} border-red-500/25 text-red-300 hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-200`
              : "border-red-500/25 text-red-300 hover:border-red-500/45 hover:bg-red-500/10 hover:text-red-200"
          }
          disabled={Boolean(busy) || lockedByDelete}
          onClick={() => run("kill", () => adminApi.killWorkload(workload.id))}
        >
          <Skull className="h-4 w-4 shrink-0" strokeWidth={2.4} />
          {compact ? null : "Kill"}
        </ActionButton>
      ) : null}

      {canDelete ? (
        <ActionButton
          title={confirmingDelete ? "Confirm delete" : "Delete workload"}
          aria-label={confirmingDelete ? "Confirm delete" : "Delete workload"}
          className={
            compact
              ? confirmingDelete
                ? "h-10 w-10 rounded-xl border-red-500/55 bg-red-500/15 p-0 text-red-100 hover:border-red-500/70 hover:bg-red-500/25 hover:text-white"
                : "h-10 w-10 rounded-xl border-red-500/25 p-0 text-red-300 hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-200"
              : confirmingDelete
                ? "border-red-500/50 bg-red-500/15 text-red-200 hover:border-red-500/60 hover:bg-red-500/25 hover:text-red-100"
                : "border-red-500/25 text-red-300 hover:border-red-500/45 hover:bg-red-500/10 hover:text-red-200"
          }
          disabled={Boolean(busy) || lockedByDelete}
          onClick={handleDelete}
        >
          <Trash2 className="h-4 w-4 shrink-0" strokeWidth={2.4} />
          {compact ? null : confirmingDelete ? "Confirm delete" : "Delete"}
        </ActionButton>
      ) : null}
    </>
  );

  if (compact) {
    return (
      <div className="space-y-2">
        <ActionBar className="flex items-center gap-2 rounded-none border-0 bg-transparent p-0">
          {buttons}
        </ActionBar>
        {message ? <p className="text-xs text-slate-500">{message}</p> : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ActionBar>{buttons}</ActionBar>
      {message ? <p className="text-sm text-slate-400">{message}</p> : null}
    </div>
  );
}
