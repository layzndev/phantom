"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { adminApi } from "@/lib/api/admin-api";
import type { AdminUser } from "@/types/admin";

export function AdminProtectedRoute({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    adminApi
      .me()
      .then(({ admin: currentAdmin }) => {
        if (!active) return;
        setAdmin(currentAdmin);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      });

    return () => {
      active = false;
    };
  }, [pathname, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm uppercase tracking-[0.3em] text-slate-500">
        Verification session admin
      </div>
    );
  }

  if (!admin) return null;

  return children;
}
