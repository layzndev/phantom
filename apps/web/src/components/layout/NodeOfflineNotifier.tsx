"use client";

import { useEffect, useRef } from "react";
import { adminApi } from "@/lib/api/admin-api";

const POLL_MS = 2_000;

export function NodeOfflineNotifier() {
  const previousStatusesRef = useRef<Map<string, string>>(new Map());
  const permissionRequestedRef = useRef(false);

  useEffect(() => {
    let active = true;

    const ensurePermission = async () => {
      if (permissionRequestedRef.current) {
        return;
      }
      permissionRequestedRef.current = true;
      if (typeof window === "undefined" || !("Notification" in window)) {
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

          if (previousStatus && previousStatus !== "offline" && node.status === "offline") {
            if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
              new Notification("Phantom node offline", {
                body: `${node.name} (${node.publicHost}) is offline.`,
                tag: `node-offline-${node.id}`
              });
            }
          }
        }

        previousStatusesRef.current = nextStatuses;
      } catch {
        // keep notifier quiet if polling fails
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

  return null;
}
