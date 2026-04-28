import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import { normalizeIp, parseIpAllowlist } from "../lib/ipAccess.js";
import { createAuditLog } from "../modules/audit/audit.repository.js";

const adminAllowlist = parseIpAllowlist(env.adminIpAllowlist);
const runtimeAllowlist = parseIpAllowlist(env.runtimeIpAllowlist);

console.info("[ipAccess] admin allowlist", {
  enforced: !adminAllowlist.isEmpty,
  entries: adminAllowlist.entries
});
console.info("[ipAccess] runtime allowlist", {
  enforced: !runtimeAllowlist.isEmpty,
  entries: runtimeAllowlist.entries
});

/**
 * Block requests on the admin control plane that originate from an IP outside
 * ADMIN_IP_ALLOWLIST. When the env is empty the middleware is a no-op so
 * existing deployments don't lock themselves out.
 */
export function requireAllowedAdminIp(req: Request, res: Response, next: NextFunction) {
  if (adminAllowlist.isEmpty) {
    next();
    return;
  }

  const ip = normalizeIp(req.ip);
  if (ip && adminAllowlist.matches(ip)) {
    next();
    return;
  }

  void createAuditLog({
    action: "admin.ip_blocked",
    actorEmail: "anonymous",
    targetType: "system",
    metadata: {
      ip: ip ?? "unknown",
      method: req.method,
      path: req.originalUrl,
      userAgent: req.get("user-agent") ?? null
    }
  }).catch((error) => {
    console.error("[ipAccess] failed to write admin.ip_blocked audit log", error);
  });

  console.warn("[ipAccess] admin request blocked", {
    ip: ip ?? "unknown",
    method: req.method,
    path: req.originalUrl
  });
  res.status(403).json({ error: "Access denied for this network." });
}

/**
 * Block requests on /runtime/* that come from outside RUNTIME_IP_ALLOWLIST.
 * Combined with the per-node bearer token this gives layered defense for the
 * agent control channel.
 */
export function requireAllowedRuntimeIp(req: Request, res: Response, next: NextFunction) {
  if (runtimeAllowlist.isEmpty) {
    next();
    return;
  }

  const ip = normalizeIp(req.ip);
  if (ip && runtimeAllowlist.matches(ip)) {
    next();
    return;
  }

  void createAuditLog({
    action: "runtime.ip_blocked",
    actorEmail: "node-agent",
    targetType: "system",
    metadata: {
      ip: ip ?? "unknown",
      method: req.method,
      path: req.originalUrl
    }
  }).catch((error) => {
    console.error("[ipAccess] failed to write runtime.ip_blocked audit log", error);
  });

  console.warn("[ipAccess] runtime request blocked", {
    ip: ip ?? "unknown",
    method: req.method,
    path: req.originalUrl
  });
  res.status(403).json({ error: "Access denied for this network." });
}

export function isAdminIpAllowlistEnforced() {
  return !adminAllowlist.isEmpty;
}

export function isRuntimeIpAllowlistEnforced() {
  return !runtimeAllowlist.isEmpty;
}
