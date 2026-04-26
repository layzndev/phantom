"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AdminShell } from "@/components/layout/AdminShell";
import { DataTable } from "@/components/ui/DataTable";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { adminApi } from "@/lib/api/admin-api";
import type { SystemNotification } from "@/types/admin";

export default function IncidentsPage() {
  const [notifications, setNotifications] = useState<SystemNotification[]>([]);

  useEffect(() => {
    void adminApi
      .notifications({ includeDismissed: false, limit: 200 })
      .then(({ notifications: nextNotifications }) => setNotifications(nextNotifications));
  }, []);

  async function markRead(id: string) {
    const { notification } = await adminApi.readNotification(id);
    setNotifications((current) =>
      current.map((item) => (item.id === id ? notification : item))
    );
  }

  async function dismiss(id: string) {
    await adminApi.dismissNotification(id);
    setNotifications((current) => current.filter((item) => item.id !== id));
  }

  return (
    <AdminShell>
      <section className="rounded-3xl border border-line bg-panel/78 p-6 shadow-soft">
        <SectionHeader
          eyebrow="Realtime alerts"
          title="Incidents"
          description="Historique recent des alertes node persistees par Phantom."
        />
        <div className="mt-6 overflow-hidden rounded-2xl border border-line">
          <DataTable
            rows={notifications}
            getRowKey={(notification) => notification.id}
            emptyTitle="No active incident"
            emptyDescription="Node alerts will appear here when Phantom records a new state transition."
            columns={[
              {
                key: "severity",
                header: "Severity",
                cell: (notification) => (
                  <span className={severityBadgeClass(notification.severity)}>
                    {notification.severity}
                  </span>
                )
              },
              {
                key: "title",
                header: "Incident",
                cell: (notification) => (
                  <div>
                    <p className="font-medium text-white">{notification.title}</p>
                    <p className="mt-1 text-slate-400">{notification.body}</p>
                  </div>
                )
              },
              {
                key: "node",
                header: "Node",
                cell: (notification) =>
                  notification.nodeId ? (
                    <Link
                      href={`/nodes/${encodeURIComponent(notification.nodeId)}`}
                      className="text-accent hover:text-accent/80"
                    >
                      {notification.nodeName ?? notification.nodeId}
                    </Link>
                  ) : (
                    <span className="text-slate-500">-</span>
                  )
              },
              {
                key: "status",
                header: "Status",
                cell: (notification) => (
                  <span className={notification.readAt ? "text-slate-500" : "text-white"}>
                    {notification.readAt ? "Read" : "Unread"}
                  </span>
                )
              },
              {
                key: "time",
                header: "Time",
                cell: (notification) => (
                  <span className="text-slate-400">
                    {new Date(notification.createdAt).toLocaleString("fr-FR")}
                  </span>
                )
              },
              {
                key: "actions",
                header: "Actions",
                cell: (notification) => (
                  <div
                    className="flex gap-3"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {!notification.readAt ? (
                      <button
                        type="button"
                        onClick={() => void markRead(notification.id)}
                        className="text-xs text-accent hover:text-accent/80"
                      >
                        Ack
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void dismiss(notification.id)}
                      className="text-xs text-slate-400 hover:text-white"
                    >
                      Dismiss
                    </button>
                  </div>
                )
              }
            ]}
          />
        </div>
      </section>
    </AdminShell>
  );
}

function severityBadgeClass(severity: SystemNotification["severity"]) {
  switch (severity) {
    case "critical":
      return "inline-flex rounded-full border border-red-300/25 bg-red-400/[0.075] px-2.5 py-1 text-xs font-medium text-red-200";
    case "warning":
      return "inline-flex rounded-full border border-amber/25 bg-amber/[0.08] px-2.5 py-1 text-xs font-medium text-amber";
    case "success":
      return "inline-flex rounded-full border border-emerald-300/25 bg-emerald-400/[0.075] px-2.5 py-1 text-xs font-medium text-emerald-200";
    case "info":
    default:
      return "inline-flex rounded-full border border-sky-300/20 bg-sky-300/[0.07] px-2.5 py-1 text-xs font-medium text-sky-200";
  }
}
