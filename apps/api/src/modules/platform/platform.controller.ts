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
  deletePlatformTenantServer,
  getPlatformTenantServer,
  provisionPlatformTenantServer,
  restartPlatformTenantServer,
  startPlatformTenantServer,
  stopPlatformTenantServer,
  updatePlatformTenantServerSettings
} from "./platform.servers.service.js";
import {
  createTenantSchema,
  deleteTenantServerQuerySchema,
  platformTenantParamsSchema,
  platformTenantServerParamsSchema,
  provisionTenantServerSchema,
  updateTenantSchema,
  updateTenantServerSettingsSchema
} from "./platform.schema.js";
import { issueConsoleTicket } from "./platform.console.tickets.js";
import { env } from "../../config/env.js";

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

platformController.post(
  "/tenants/:id/servers",
  validateParams(platformTenantParamsSchema),
  validateBody(provisionTenantServerSchema),
  asyncHandler(async (req, res) => {
    const detail = await provisionPlatformTenantServer(req.params.id, req.body);
    await audit(req, "platform.server.create", {
      targetId: detail.server.id,
      metadata: {
        tenantId: req.params.id,
        slug: detail.server.slug,
        templateId: detail.server.templateId,
        version: detail.server.minecraftVersion,
        ramMb: detail.workload.requestedRamMb,
        cpu: detail.workload.requestedCpu,
        diskGb: detail.workload.requestedDiskGb
      }
    });
    res.status(201).json({ server: detail });
  })
);

platformController.get(
  "/tenants/:id/servers/:serverId",
  validateParams(platformTenantServerParamsSchema),
  asyncHandler(async (req, res) => {
    const detail = await getPlatformTenantServer(req.params.id, req.params.serverId);
    res.json({ server: detail });
  })
);

platformController.post(
  "/tenants/:id/servers/:serverId/start",
  validateParams(platformTenantServerParamsSchema),
  asyncHandler(async (req, res) => {
    const result = await startPlatformTenantServer(req.params.id, req.params.serverId);
    await audit(req, "platform.server.start", {
      targetId: req.params.serverId,
      metadata: { tenantId: req.params.id }
    });
    res.json(result);
  })
);

platformController.post(
  "/tenants/:id/servers/:serverId/stop",
  validateParams(platformTenantServerParamsSchema),
  asyncHandler(async (req, res) => {
    const result = await stopPlatformTenantServer(req.params.id, req.params.serverId);
    await audit(req, "platform.server.stop", {
      targetId: req.params.serverId,
      metadata: { tenantId: req.params.id }
    });
    res.json(result);
  })
);

platformController.post(
  "/tenants/:id/servers/:serverId/restart",
  validateParams(platformTenantServerParamsSchema),
  asyncHandler(async (req, res) => {
    const result = await restartPlatformTenantServer(req.params.id, req.params.serverId);
    await audit(req, "platform.server.restart", {
      targetId: req.params.serverId,
      metadata: { tenantId: req.params.id }
    });
    res.json(result);
  })
);

platformController.delete(
  "/tenants/:id/servers/:serverId",
  validateParams(platformTenantServerParamsSchema),
  asyncHandler(async (req, res) => {
    const parsed = deleteTenantServerQuerySchema.safeParse(req.query);
    const hardDeleteData = parsed.success ? parsed.data.hardDeleteData : false;
    const result = await deletePlatformTenantServer(req.params.id, req.params.serverId, {
      hardDeleteData
    });
    await audit(req, "platform.server.delete", {
      targetId: req.params.serverId,
      metadata: { tenantId: req.params.id, hardDeleteData, finalized: result.finalized }
    });
    res.status(result.finalized ? 200 : 202).json(result);
  })
);

platformController.patch(
  "/tenants/:id/servers/:serverId/settings",
  validateParams(platformTenantServerParamsSchema),
  validateBody(updateTenantServerSettingsSchema),
  asyncHandler(async (req, res) => {
    const detail = await updatePlatformTenantServerSettings(
      req.params.id,
      req.params.serverId,
      req.body
    );
    await audit(req, "platform.server.settings", {
      targetId: req.params.serverId,
      metadata: { tenantId: req.params.id, fields: Object.keys(req.body) }
    });
    res.json({ server: detail });
  })
);

/**
 * Issue a single-use, short-lived ticket the Hosting frontend can hand
 * to its customer to open the Phantom console WebSocket without ever
 * seeing the platform bearer.
 *
 * Returns:
 *   { ticket, url, expiresAt, ttlSeconds }
 *
 * The frontend opens `${url}` (or `${url}?ticket=…` if it builds the
 * URL itself) and Phantom consumes the ticket on upgrade.
 */
platformController.post(
  "/tenants/:id/servers/:serverId/console-url",
  validateParams(platformTenantServerParamsSchema),
  asyncHandler(async (req, res) => {
    // Validate ownership before minting the ticket.
    const detail = await getPlatformTenantServer(req.params.id, req.params.serverId);
    const ticketRecord = issueConsoleTicket({
      serverId: detail.server.id,
      tenantId: req.params.id,
      mintedBy: req.platformToken?.name ?? "unknown"
    });
    const baseUrl = env.publicWsBaseUrl || `ws://${env.host}:${env.port}`;
    const url = `${baseUrl}/runtime/minecraft/servers/${detail.server.id}/console?ticket=${encodeURIComponent(ticketRecord.ticket)}`;
    await audit(req, "platform.server.console_url", {
      targetId: req.params.serverId,
      metadata: { tenantId: req.params.id, ttlSeconds: ticketRecord.ttlSeconds }
    });
    res.status(201).json({
      ticket: ticketRecord.ticket,
      url,
      expiresAt: ticketRecord.expiresAt,
      ttlSeconds: ticketRecord.ttlSeconds
    });
  })
);

async function audit(
  req: import("express").Request,
  action:
    | "platform.tenants.list"
    | "platform.tenant.create"
    | "platform.tenant.update"
    | "platform.tenant.delete"
    | "platform.server.create"
    | "platform.server.start"
    | "platform.server.stop"
    | "platform.server.restart"
    | "platform.server.delete"
    | "platform.server.settings"
    | "platform.server.console_url",
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
