import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import { normalizeIp } from "../lib/ipAccess.js";
import { createAuditLog } from "../modules/audit/audit.repository.js";

interface IpFailureState {
  count: number;
  firstFailureAt: number;
  blockedUntil: number;
}

const failures = new Map<string, IpFailureState>();
const PRUNE_INTERVAL_MS = 5 * 60_000;

setInterval(() => {
  const now = Date.now();
  for (const [ip, state] of failures.entries()) {
    if (state.blockedUntil < now && now - state.firstFailureAt > env.loginIpFailureWindowMs) {
      failures.delete(ip);
    }
  }
}, PRUNE_INTERVAL_MS).unref();

/**
 * Block login attempts coming from an IP that has accumulated too many
 * failures within the rolling window. The lockout is in-process (single API
 * instance) which is acceptable for the threat model: an attacker that
 * survives a process restart still hits per-account lockout + the global
 * rate limiter.
 */
export function loginIpGuard(req: Request, res: Response, next: NextFunction) {
  if (env.loginIpLockoutThreshold <= 0) {
    next();
    return;
  }
  const ip = normalizeIp(req.ip);
  if (!ip) {
    next();
    return;
  }
  const state = failures.get(ip);
  if (state && state.blockedUntil > Date.now()) {
    const retryAfter = Math.max(1, Math.ceil((state.blockedUntil - Date.now()) / 1000));
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({
      error: "Too many failed login attempts from this network. Try again later.",
      code: "LOGIN_IP_LOCKED"
    });
    return;
  }
  next();
}

export function recordLoginFailureForIp(req: Request, email: string | undefined) {
  if (env.loginIpLockoutThreshold <= 0) return;
  const ip = normalizeIp(req.ip);
  if (!ip) return;
  const now = Date.now();
  const existing = failures.get(ip);
  const state: IpFailureState = existing && now - existing.firstFailureAt <= env.loginIpFailureWindowMs
    ? existing
    : { count: 0, firstFailureAt: now, blockedUntil: 0 };
  state.count += 1;
  if (state.count >= env.loginIpLockoutThreshold) {
    state.blockedUntil = now + env.loginIpLockoutMs;
    void createAuditLog({
      action: "admin.login_ip_locked",
      actorEmail: email ?? "anonymous",
      targetType: "system",
      metadata: {
        ip,
        attemptCount: state.count,
        lockoutMs: env.loginIpLockoutMs,
        userAgent: req.get("user-agent") ?? null
      }
    }).catch((error) => {
      console.error("[loginIpThrottle] failed to write admin.login_ip_locked audit", error);
    });
  }
  failures.set(ip, state);
}

export function clearLoginFailuresForIp(req: Request) {
  const ip = normalizeIp(req.ip);
  if (!ip) return;
  failures.delete(ip);
}
