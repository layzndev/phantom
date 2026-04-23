"use client";

import { FormEvent, useState } from "react";
import { Suspense } from "react";
import { ShieldCheck } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { adminApi } from "@/lib/api/admin-api";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("admin@company.local");
  const [password, setPassword] = useState("ChangeMe-Admin-2026!");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await adminApi.login(email, password);
      router.replace(searchParams.get("next") ?? "/");
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-5 py-10">
      <section className="w-full max-w-md overflow-hidden rounded-3xl border border-line bg-panel/85 shadow-soft backdrop-blur-xl">
        <div className="border-b border-line bg-white/[0.025] p-7">
          <div className="flex size-13 items-center justify-center rounded-2xl border border-accent/25 bg-accent/[0.08] text-accent">
            <ShieldCheck size={26} />
          </div>
          <p className="mt-6 text-[11px] uppercase tracking-[0.32em] text-accent/90">Phantom</p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white">Secure operator login</h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">Ready 2FA and fine-grained access policies.</p>
        </div>
        <form onSubmit={submit} className="space-y-5 p-7">
          <label className="block">
            <span className="text-sm font-medium text-slate-300">Email address of your admin account</span>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              autoComplete="username"
              className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 text-white outline-none transition focus:border-accent/40"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-300">Mot de passe</span>
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              autoComplete="current-password"
              className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 text-white outline-none transition focus:border-accent/40"
            />
          </label>
          {error ? <p className="rounded-2xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-100">{error}</p> : null}
          <button disabled={loading} className="w-full rounded-2xl border border-accent/20 bg-accent/90 px-5 py-3 font-semibold text-obsidian transition hover:bg-accent disabled:opacity-60">
            {loading ? "Verification..." : "Open control plane"}
          </button>
        </form>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="grid min-h-screen place-items-center text-sm text-slate-500">Preparing secure login...</main>}>
      <LoginForm />
    </Suspense>
  );
}
