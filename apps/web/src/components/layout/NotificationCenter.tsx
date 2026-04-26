"use client";

import Link from "next/link";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Info,
  TriangleAlert,
  X
} from "lucide-react";
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
import type { NotificationSeverity, SystemNotification } from "@/types/admin";

const POLL_MS = 2_000;
const TOAST_TTL_MS = 8_000;

type ToastNotification = SystemNotification;

type NotificationCenterValue = {
  notifications: SystemNotification[];
  unreadCount: number;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  dismiss: (id: string) => Promise<void>;
};

const NotificationCenterContext = createContext<NotificationCenterValue | null>(null);

export function NotificationCenterProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<SystemNotification[]>([]);
  const [toasts, setToasts] = useState<ToastNotification[]>([]);
  const knownIdsRef = useRef<Set<string>>(new Set());
  const bootstrappedRef = useRef(false);
  const permissionRequestedRef = useRef(false);

  useEffect(() => {
    let active = true;

    const ensurePermission = async () => {
      if (permissionRequestedRef.current) return;
      permissionRequestedRef.current = true;
      if (!("Notification" in window)) return;
      if (Notification.permission === "default") {
        try {
          await Notification.requestPermission();
        } catch {
          // ignore permission errors
        }
      }
    };

    const enqueueToast = (notification: SystemNotification) => {
      setToasts((current) => [notification, ...current].slice(0, 5));
      window.setTimeout(() => {
        if (!active) return;
        setToasts((current) => current.filter((item) => item.id !== notification.id));
      }, TOAST_TTL_MS);

      if ("Notification" in window && Notification.permission === "granted") {
        new Notification(notification.title, {
          body: notification.body,
          tag: notification.id
        });
      }

      if (notification.severity === "critical") {
        playCriticalSound();
      }
    };

    const refresh = async () => {
      try {
        const { notifications: nextNotifications } = await adminApi.notifications({
          limit: 100
        });
        if (!active) return;

        setNotifications(nextNotifications);

        const nextIds = new Set(nextNotifications.map((item) => item.id));
        if (!bootstrappedRef.current) {
          knownIdsRef.current = nextIds;
          bootstrappedRef.current = true;
          return;
        }

        for (const notification of nextNotifications) {
          if (!knownIdsRef.current.has(notification.id)) {
            enqueueToast(notification);
          }
        }

        knownIdsRef.current = nextIds;
      } catch {
        // keep center quiet if polling fails
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
      unreadCount: notifications.filter((item) => item.readAt === null).length,
      markRead: async (id: string) => {
        const { notification } = await adminApi.readNotification(id);
        setNotifications((current) =>
          current.map((item) => (item.id === id ? notification : item))
        );
      },
      markAllRead: async () => {
        await adminApi.readAllNotifications();
        setNotifications((current) =>
          current.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() }))
        );
      },
      dismiss: async (id: string) => {
        await adminApi.dismissNotification(id);
        setNotifications((current) => current.filter((item) => item.id !== id));
        setToasts((current) => current.filter((item) => item.id !== id));
        knownIdsRef.current.delete(id);
      }
    }),
    [notifications]
  );

  return (
    <NotificationCenterContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[120] flex w-full max-w-sm flex-col gap-3">
        {toasts.map((toast) => {
          const theme = severityTheme(toast.severity);
          const Icon = severityIcon(toast.severity);
          return (
            <div
              key={toast.id}
              className={`pointer-events-auto rounded-2xl border p-4 shadow-soft backdrop-blur-xl ${theme.toast}`}
            >
              <div className="flex items-start gap-3">
                <span className={`mt-0.5 rounded-xl border p-2 ${theme.badge}`}>
                  <Icon size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-semibold ${theme.title}`}>{toast.title}</p>
                  <p className={`mt-1 text-sm ${theme.body}`}>{toast.body}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void value.dismiss(toast.id)}
                  className="rounded-full p-1 text-white/80 transition hover:bg-white/10 hover:text-white"
                  aria-label="Dismiss notification"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          );
        })}
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
        <div className="absolute right-0 top-14 z-[130] w-[380px] overflow-hidden rounded-2xl border border-white/10 bg-obsidian/95 shadow-soft backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-white">Notifications</p>
              <p className="text-xs text-slate-500">{center.unreadCount} unread</p>
            </div>
            <button
              type="button"
              onClick={() => void center.markAllRead()}
              className="text-xs text-accent hover:text-accent/80"
            >
              Mark all read
            </button>
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {center.notifications.length === 0 ? (
              <div className="px-4 py-6 text-sm text-slate-500">No notifications yet.</div>
            ) : (
              center.notifications.map((notification) => {
                const theme = severityTheme(notification.severity);
                const Icon = severityIcon(notification.severity);
                return (
                  <div
                    key={notification.id}
                    className={`border-b border-white/5 px-4 py-3 ${
                      notification.readAt ? "bg-transparent" : "bg-white/[0.03]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`rounded-lg border p-1.5 ${theme.badge}`}>
                            <Icon size={14} />
                          </span>
                          <p className="text-sm font-medium text-white">{notification.title}</p>
                        </div>
                        <p className="mt-2 text-sm text-slate-400">{notification.body}</p>
                        {notification.nodeId ? (
                          <Link
                            href={`/nodes/${encodeURIComponent(notification.nodeId)}`}
                            className="mt-2 inline-flex text-xs text-accent hover:text-accent/80"
                          >
                            Open node
                          </Link>
                        ) : null}
                        <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-slate-600">
                          {new Date(notification.createdAt).toLocaleString("fr-FR")}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        {!notification.readAt ? (
                          <button
                            type="button"
                            onClick={() => void center.markRead(notification.id)}
                            className="text-xs text-accent hover:text-accent/80"
                          >
                            Ack
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void center.dismiss(notification.id)}
                          className="text-xs text-slate-500 hover:text-white"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function useNotificationCenter() {
  const center = useContext(NotificationCenterContext);
  if (!center) {
    throw new Error("useNotificationCenter must be used within NotificationCenterProvider");
  }
  return center;
}

function severityTheme(severity: NotificationSeverity) {
  switch (severity) {
    case "critical":
      return {
        toast: "border-red-400/25 bg-red-500/[0.10]",
        badge: "border-red-300/20 bg-red-400/[0.10] text-red-200",
        title: "text-red-100",
        body: "text-red-50/90"
      };
    case "warning":
      return {
        toast: "border-amber-400/25 bg-amber-500/[0.10]",
        badge: "border-amber-300/20 bg-amber-400/[0.10] text-amber-100",
        title: "text-amber-50",
        body: "text-amber-50/90"
      };
    case "success":
      return {
        toast: "border-emerald-400/25 bg-emerald-500/[0.10]",
        badge: "border-emerald-300/20 bg-emerald-400/[0.10] text-emerald-200",
        title: "text-emerald-100",
        body: "text-emerald-50/90"
      };
    case "info":
    default:
      return {
        toast: "border-sky-400/25 bg-sky-500/[0.10]",
        badge: "border-sky-300/20 bg-sky-400/[0.10] text-sky-100",
        title: "text-sky-50",
        body: "text-sky-50/90"
      };
  }
}

function severityIcon(severity: NotificationSeverity) {
  switch (severity) {
    case "critical":
      return AlertTriangle;
    case "warning":
      return TriangleAlert;
    case "success":
      return CheckCircle2;
    case "info":
    default:
      return Info;
  }
}

function playCriticalSound() {
  try {
    const AudioContextCtor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    const context = new AudioContextCtor();
    const now = context.currentTime;

    playBeep(context, now, 880, 0.08);
    playBeep(context, now + 0.12, 660, 0.12);

    window.setTimeout(() => {
      void context.close().catch(() => undefined);
    }, 500);
  } catch {
    // ignore sound failures
  }
}

function playBeep(context: AudioContext, startAt: number, frequency: number, duration: number) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.08, startAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration);
}
