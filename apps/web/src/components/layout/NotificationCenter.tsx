"use client";

import { AlertTriangle, Bell, CheckCircle2, X } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { adminApi } from "@/lib/api/admin-api";

const POLL_MS = 2_000;
const TOAST_TTL_MS = 8_000;
const STORAGE_KEY = "phantom-notifications";

type NotificationKind = "node_offline" | "node_recovered";

export type AppNotification = {
  id: string;
  kind: NotificationKind;
  nodeId: string;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
};

type ToastNotification = AppNotification;

type NotificationCenterValue = {
  notifications: AppNotification[];
  unreadCount: number;
  markRead: (id: string) => void;
  markAllRead: () => void;
  dismiss: (id: string) => void;
};

const NotificationCenterContext = createContext<NotificationCenterValue | null>(null);

export function NotificationCenterProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [toasts, setToasts] = useState<ToastNotification[]>([]);
  const previousStatusesRef = useRef<Map<string, string>>(new Map());
  const permissionRequestedRef = useRef(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as AppNotification[];
      if (Array.isArray(parsed)) {
        setNotifications(parsed);
      }
    } catch {
      // ignore corrupted local storage
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications));
  }, [notifications]);

  useEffect(() => {
    let active = true;

    const ensurePermission = async () => {
      if (permissionRequestedRef.current) {
        return;
      }
      permissionRequestedRef.current = true;
      if (!("Notification" in window)) {
        return;
      }
      if (Notification.permission === "default") {
        try {
          await Notification.requestPermission();
        } catch {
          // ignore permission errors
        }
      }
    };

    const pushNotification = (notification: AppNotification) => {
      setNotifications((current) => {
        const deduped = current.filter(
          (item) => !(item.nodeId === notification.nodeId && item.kind === notification.kind && item.read === false)
        );
        return [notification, ...deduped].slice(0, 100);
      });
      setToasts((current) => [notification, ...current].slice(0, 5));
      window.setTimeout(() => {
        if (!active) return;
        setToasts((current) => current.filter((item) => item.id !== notification.id));
      }, TOAST_TTL_MS);

      if ("Notification" in window && Notification.permission === "granted") {
        new Notification(notification.title, {
          body: notification.body,
          tag: `${notification.kind}-${notification.nodeId}`
        });
      }
    };

    const refresh = async () => {
      try {
        const { nodes } = await adminApi.nodes();
        if (!active) {
          return;
        }

        const nextStatuses = new Map<string, string>();
        for (const node of nodes) {
          const previousStatus = previousStatusesRef.current.get(node.id);
          nextStatuses.set(node.id, node.status);

          if (!previousStatus) {
            continue;
          }

          if (previousStatus !== "offline" && node.status === "offline") {
            pushNotification({
              id: `${node.id}-offline-${Date.now()}`,
              kind: "node_offline",
              nodeId: node.id,
              title: "Node offline",
              body: `${node.name} (${node.publicHost}) is offline.`,
              createdAt: new Date().toISOString(),
              read: false
            });
            continue;
          }

          if (previousStatus === "offline" && node.status === "healthy") {
            pushNotification({
              id: `${node.id}-healthy-${Date.now()}`,
              kind: "node_recovered",
              nodeId: node.id,
              title: "Node recovered",
              body: `${node.name} (${node.publicHost}) is healthy again.`,
              createdAt: new Date().toISOString(),
              read: false
            });
          }
        }

        previousStatusesRef.current = nextStatuses;
      } catch {
        // keep notification center quiet if polling fails
      }
    };

    void ensurePermission();
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, POLL_MS);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const value = useMemo<NotificationCenterValue>(
    () => ({
      notifications,
      unreadCount: notifications.filter((item) => !item.read).length,
      markRead: (id: string) =>
        setNotifications((current) =>
          current.map((item) => (item.id === id ? { ...item, read: true } : item))
        ),
      markAllRead: () =>
        setNotifications((current) => current.map((item) => ({ ...item, read: true }))),
      dismiss: (id: string) => {
        setNotifications((current) => current.filter((item) => item.id !== id));
        setToasts((current) => current.filter((item) => item.id !== id));
      }
    }),
    [notifications]
  );

  return (
    <NotificationCenterContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[120] flex w-full max-w-sm flex-col gap-3">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-2xl border p-4 shadow-soft backdrop-blur-xl ${
              toast.kind === "node_offline"
                ? "border-red-400/25 bg-red-500/[0.10]"
                : "border-emerald-400/25 bg-emerald-500/[0.10]"
            }`}
          >
            <div className="flex items-start gap-3">
              <span
                className={`mt-0.5 rounded-xl border p-2 ${
                  toast.kind === "node_offline"
                    ? "border-red-300/20 bg-red-400/[0.10] text-red-200"
                    : "border-emerald-300/20 bg-emerald-400/[0.10] text-emerald-200"
                }`}
              >
                {toast.kind === "node_offline" ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={`text-sm font-semibold ${
                    toast.kind === "node_offline" ? "text-red-100" : "text-emerald-100"
                  }`}
                >
                  {toast.title}
                </p>
                <p
                  className={`mt-1 text-sm ${
                    toast.kind === "node_offline" ? "text-red-50/90" : "text-emerald-50/90"
                  }`}
                >
                  {toast.body}
                </p>
              </div>
              <button
                type="button"
                onClick={() => value.dismiss(toast.id)}
                className="rounded-full p-1 text-white/80 transition hover:bg-white/10 hover:text-white"
                aria-label="Dismiss notification"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </NotificationCenterContext.Provider>
  );
}

export function NotificationBell() {
  const center = useNotificationCenter();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="relative rounded-full border border-white/10 p-2.5 text-slate-400 transition hover:border-white/20 hover:text-slate-200"
        aria-label="Notifications"
      >
        <Bell size={18} />
        {center.unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-semibold text-white">
            {center.unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-14 z-[130] w-[360px] overflow-hidden rounded-2xl border border-white/10 bg-obsidian/95 shadow-soft backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-white">Notifications</p>
              <p className="text-xs text-slate-500">{center.unreadCount} unread</p>
            </div>
            <button
              type="button"
              onClick={() => center.markAllRead()}
              className="text-xs text-accent hover:text-accent/80"
            >
              Mark all read
            </button>
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {center.notifications.length === 0 ? (
              <div className="px-4 py-6 text-sm text-slate-500">No notifications yet.</div>
            ) : (
              center.notifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`border-b border-white/5 px-4 py-3 ${
                    notification.read ? "bg-transparent" : "bg-white/[0.03]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white">{notification.title}</p>
                      <p className="mt-1 text-sm text-slate-400">{notification.body}</p>
                      <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-slate-600">
                        {new Date(notification.createdAt).toLocaleString("fr-FR")}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {!notification.read ? (
                        <button
                          type="button"
                          onClick={() => center.markRead(notification.id)}
                          className="text-xs text-accent hover:text-accent/80"
                        >
                          Ack
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => center.dismiss(notification.id)}
                        className="text-xs text-slate-500 hover:text-white"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function useNotificationCenter() {
  const context = useContext(NotificationCenterContext);
  if (!context) {
    throw new Error("useNotificationCenter must be used within NotificationCenterProvider");
  }
  return context;
}
