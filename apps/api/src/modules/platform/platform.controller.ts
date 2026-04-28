import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { validateBody, validateParams } from "../../lib/validate.js";
import { requirePlatformToken } from "../../middleware/platformTokenMiddleware.js";
import type { Prisma } from "@prisma/client";
import { createAuditLog } from "../audit/audit.repository.js";
import { normalizeIp } from "../../lib/ipAccess.js";
import {
  createPlatformTenant,
  deletePlatformTenant,
  getPlatformTenant,
  listPlatformTenantServers,
  listPlatformTenants,
  updatePlatformTenant
} from "./platform.service.js";
import {
  createTenantSchema,
  platformTenantParamsSchema,
  updateTenantSchema
} from "./platform.schema.js";

export const platformController = Router();

// All routes require a valid platform token.
platformController.use(requirePlatformToken);

platformController.get(
  "/tenants",
  asyncHandler(async (req, res) => {
    await audit(req, "platform.tenants.list");
    const tenants = await listPlatformTenants();
    res.json({ tenants });
  })
);

platformController.post(
  "/tenants",
  validateBody(createTenantSchema),
  asyncHandler(async (req, res) => {
    const tenant = await createPlatformTenant(req.body);
    await audit(req, "platform.tenant.create", {
      targetId: tenant.id,
      metadata: { slug: tenant.slug, planTier: tenant.planTier }
    });
    res.status(201).json({ tenant });
  })
);

platformController.get(
  "/tenants/:id",
  validateParams(platformTenantParamsSchema),
  asyncHandler(async (req, res) => {
    const tenant = await getPlatformTenant(req.params.id);
    res.json({ tenant });
  })
);

platformController.patch(
  "/tenants/:id",
  validateParams(platformTenantParamsSchema),
  validateBody(updateTenantSchema),
  asyncHandler(async (req, res) => {
    const tenant = await updatePlatformTenant(req.params.id, req.body);
    await audit(req, "platform.tenant.update", {
      targetId: tenant.id,
      metadata: { changes: Object.keys(req.body) }
    });
    res.json({ tenant });
  })
);

platformController.delete(
  "/tenants/:id",
  validateParams(platformTenantParamsSchema),
  asyncHandler(async (req, res) => {
    const tenant = await deletePlatformTenant(req.params.id);
    await audit(req, "platform.tenant.delete", {
      targetId: tenant.id
    });
    res.json({ tenant });
  })
);

platformController.get(
  "/tenants/:id/servers",
  validateParams(platformTenantParamsSchema),
  asyncHandler(async (req, res) => {
    const servers = await listPlatformTenantServers(req.params.id);
    res.json({ servers });
  })
);

async function audit(
  req: import("express").Request,
  action:
    | "platform.tenants.list"
    | "platform.tenant.create"
    | "platform.tenant.update"
    | "platform.tenant.delete",
  options: { targetId?: string; metadata?: Record<string, unknown> } = {}
) {
  await createAuditLog({
    action,
    actorEmail: `platform-token:${req.platformToken?.name ?? "unknown"}`,
    targetType: "system",
    targetId: options.targetId,
    metadata: options.metadata as Prisma.InputJsonValue | undefined,
    ipAddress: normalizeIp(req.ip) ?? undefined,
    userAgent: req.get("user-agent") ?? undefined
  });
}
