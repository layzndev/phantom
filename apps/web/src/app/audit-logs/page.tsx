"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "@/components/layout/AdminShell";
import { adminApi } from "@/lib/api/admin-api";
import type { AuditLogEntry } from "@/types/admin";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { DataTable } from "@/components/ui/DataTable";

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);

  useEffect(() => {
    adminApi.auditLogs().then(({ auditLogs }) => setLogs(auditLogs));
  }, []);

  return (
    <AdminShell>
      <section className="rounded-3xl border border-line bg-panel/78 p-6 shadow-soft">
        <SectionHeader eyebrow="Security ready" title="Audit Logs" description="Journal admin in-process pour la V1, pret a brancher sur un stockage durable ou un SIEM." />
        <div className="mt-6 overflow-hidden rounded-2xl border border-line">
          <DataTable
            rows={logs}
            getRowKey={(log) => log.id}
            emptyTitle="No audit event yet"
            emptyDescription="Admin actions will appear here as soon as the API receives authenticated activity."
            columns={[
              { key: "action", header: "Action", cell: (log) => <span className="font-medium text-white">{log.action}</span> },
              { key: "actor", header: "Actor", cell: (log) => <span className="text-slate-300">{log.actorEmail}</span> },
              { key: "target", header: "Target", cell: (log) => <span className="text-slate-300">{log.targetType ? `${log.targetType}:${log.targetId}` : "-"}</span> },
              { key: "time", header: "Time", cell: (log) => <span className="text-slate-400">{new Date(log.createdAt).toLocaleString("fr-FR")}</span> }
            ]}
          />
        </div>
      </section>
    </AdminShell>
  );
}
