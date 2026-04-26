import { Router } from "express";
import { AppError } from "../../lib/appError.js";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { validateBody, validateParams } from "../../lib/validate.js";
import { requireAdmin, requireRole } from "../../middleware/authMiddleware.js";
import { writeAuditLog } from "../audit/audit.service.js";
import {
  archiveMinecraftFilePath,
  createMinecraftServer,
  deleteMinecraftFilePath,
  deleteMinecraftServer,
  enqueueMinecraftOperation,
  extractMinecraftArchive,
  getMinecraftOperation,
  getMinecraftServer,
  getMinecraftTemplates,
  listMinecraftFiles,
  listMinecraftServers,
  mkdirMinecraftFilePath,
  readMinecraftFile,
  renameMinecraftFilePath,
  restartMinecraftServer,
  startMinecraftServer,
  stopMinecraftServer,
  uploadMinecraftFile,
  updateMinecraftServerHostname,
  writeMinecraftFile
} from "./minecraft.service.js";
import {
  createMinecraftServerSchema,
  deleteMinecraftServerQuerySchema,
  minecraftCommandSchema,
  minecraftFilesArchiveSchema,
  minecraftFilesDeleteSchema,
  minecraftFilesExtractSchema,
  minecraftFilesListQuerySchema,
  minecraftFilesMkdirSchema,
  minecraftFilesReadQuerySchema,
  minecraftFilesRenameSchema,
  minecraftFilesWriteSchema,
  minecraftLogsQuerySchema,
  minecraftOperationParamsSchema,
  minecraftServerParamsSchema,
  updateMinecraftHostnameSchema
} from "./minecraft.schema.js";

export const minecraftController = Router();

minecraftController.use(requireAdmin);

minecraftController.get(
  "/templates",
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const templates = await getMinecraftTemplates();
    await writeAuditLog(req, {
      action: "minecraft.template.list",
      actorId: actor.id,
      actorEmail: actor.email
    });
    res.json({ templates });
  })
);

minecraftController.get(
  "/servers",
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const servers = await listMinecraftServers();
    await writeAuditLog(req, {
      action: "minecraft.server.list",
      actorId: actor.id,
      actorEmail: actor.email
    });
    res.json({ servers });
  })
);

minecraftController.post(
  "/servers",
  requireRole(["superadmin", "ops"]),
  validateBody(createMinecraftServerSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const result = await createMinecraftServer(req.body, { email: actor.email });
    await writeAuditLog(req, {
      action: "minecraft.server.create",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "system",
      targetId: result.server.id,
      metadata: {
        workloadId: result.workload.id,
        hostname: result.server.hostname,
        hostnameSlug: result.server.hostnameSlug,
        dnsStatus: result.server.dnsStatus,
        templateId: result.server.templateId,
        version: result.server.minecraftVersion,
        placed: result.placed,
        nodeId: result.workload.nodeId,
        reason: result.reason,
        planTier: result.server.planTier,
        requiredPool: result.diagnostics?.requiredPool,
        candidates: result.diagnostics?.candidates
      }
    });
    res.status(201).json(result);
  })
);

minecraftController.get(
  "/servers/:id/files",
  validateParams(minecraftServerParamsSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const parsed = minecraftFilesListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(400, "Invalid query parameters.", "VALIDATION_ERROR", parsed.error.flatten());
    }
    const result = await listMinecraftFiles(req.params.id, parsed.data.path, {
      id: actor.id,
      email: actor.email,
      role: actor.role
    });
    res.json(result);
  })
);

minecraftController.get(
  "/servers/:id/files/read",
  validateParams(minecraftServerParamsSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const parsed = minecraftFilesReadQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(400, "Invalid query parameters.", "VALIDATION_ERROR", parsed.error.flatten());
    }
    const result = await readMinecraftFile(req.params.id, parsed.data.path, {
      id: actor.id,
      email: actor.email,
      role: actor.role
    });
    res.json(result);
  })
);

minecraftController.put(
  "/servers/:id/files/write",
  requireRole(["superadmin", "ops"]),
  validateParams(minecraftServerParamsSchema),
  validateBody(minecraftFilesWriteSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const result = await writeMinecraftFile(req.params.id, req.body.path, req.body.content, {
      id: actor.id,
      email: actor.email,
      role: actor.role
    });
    await writeAuditLog(req, {
      action: "minecraft.server.file.write",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "system",
      targetId: req.params.id,
      metadata: { path: req.body.path, opId: result.operation.id }
    });
    res.status(result.pending ? 202 : 200).json(result);
  })
);

minecraftController.post(
  "/servers/:id/files/upload",
  requireRole(["superadmin", "ops"]),
  validateParams(minecraftServerParamsSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const upload = await parseMultipartUpload(req);
    const result = await uploadMinecraftFile(req.params.id, upload.path, upload.contentBase64, {
      id: actor.id,
      email: actor.email,
      role: actor.role
    });
    await writeAuditLog(req, {
      action: "minecraft.server.file.upload",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "system",
      targetId: req.params.id,
      metadata: { path: upload.path, sizeBytes: upload.sizeBytes, opId: result.operation.id }
    });
    res.status(result.pending ? 202 : 200).json(result);
  })
);

minecraftController.post(
  "/servers/:id/files/mkdir",
  requireRole(["superadmin", "ops"]),
  validateParams(minecraftServerParamsSchema),
  validateBody(minecraftFilesMkdirSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const result = await mkdirMinecraftFilePath(req.params.id, req.body.path, {
      id: actor.id,
      email: actor.email,
      role: actor.role
    });
    await writeAuditLog(req, {
      action: "minecraft.server.file.mkdir",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "system",
      targetId: req.params.id,
      metadata: { path: req.body.path, opId: result.operation.id }
    });
    res.status(result.pending ? 202 : 200).json(result);
  })
);

minecraftController.post(
  "/servers/:id/files/rename",
  requireRole(["superadmin", "ops"]),
  validateParams(minecraftServerParamsSchema),
  validateBody(minecraftFilesRenameSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const result = await renameMinecraftFilePath(req.params.id, req.body.from, req.body.to, {
      id: actor.id,
      email: actor.email,
      role: actor.role
    });
    await writeAuditLog(req, {
      action: "minecraft.server.file.rename",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "system",
      targetId: req.params.id,
      metadata: { from: req.body.from, to: req.body.to, opId: result.operation.id }
    });
    res.status(result.pending ? 202 : 200).json(result);
  })
);

minecraftController.delete(
  "/servers/:id/files",
  requireRole(["superadmin", "ops"]),
  validateParams(minecraftServerParamsSchema),
  validateBody(minecraftFilesDeleteSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const result = await deleteMinecraftFilePath(req.params.id, req.body.path, {
      id: actor.id,
      email: actor.email,
      role: actor.role
    });
    await writeAuditLog(req, {
      action: "minecraft.server.file.delete",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "system",
      targetId: req.params.id,
      metadata: { path: req.body.path, opId: result.operation.id }
    });
    res.status(result.pending ? 202 : 200).json(result);
  })
);

minecraftController.post(
  "/servers/:id/files/archive",
  requireRole(["superadmin", "ops"]),
  validateParams(minecraftServerParamsSchema),
  validateBody(minecraftFilesArchiveSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const result = await archiveMinecraftFilePath(req.params.id, req.body.path, {
      id: actor.id,
      email: actor.email,
      role: actor.role
    });
    await writeAuditLog(req, {
      action: "minecraft.server.file.archive",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "system",
      targetId: req.params.id,
      metadata: { path: req.body.path, opId: result.operation.id }
    });
    res.status(result.pending ? 202 : 200).json(result);
  })
);

minecraftController.post(
  "/servers/:id/files/extract",
  requireRole(["superadmin", "ops"]),
  validateParams(minecraftServerParamsSchema),
  validateBody(minecraftFilesExtractSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const result = await extractMinecraftArchive(req.params.id, req.body.path, {
      id: actor.id,
      email: actor.email,
      role: actor.role
    });
    await writeAuditLog(req, {
      action: "minecraft.server.file.extract",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "system",
      targetId: req.params.id,
      metadata: { path: req.body.path, opId: result.operation.id }
    });
    res.status(result.pending ? 202 : 200).json(result);
  })
);

minecraftController.get(
  "/servers/:id",
  validateParams(minecraftServerParamsSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const result = await getMinecraftServer(req.params.id);
    await writeAuditLog(req, {
      action: "minecraft.server.detail",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "system",
      targetId: req.params.id
    });
    res.json(result);
  })
);

async function parseMultipartUpload(req: import("express").Request) {
  const contentType = req.headers["content-type"] ?? "";
  const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
  if (!boundaryMatch) {
    throw new AppError(400, "Missing multipart boundary.", "INVALID_MULTIPART");
  }

  const boundary = `--${boundaryMatch[1]}`;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks);
  const bodyText = body.toString("binary");
  const segments = bodyText.split(boundary).slice(1, -1);

  let path = "";
  let fileBuffer: Buffer | null = null;

  for (const rawSegment of segments) {
    const segment = rawSegment.replace(/^\r\n/, "").replace(/\r\n$/, "");
    const separator = segment.indexOf("\r\n\r\n");
    if (separator === -1) continue;
    const headerText = segment.slice(0, separator);
    const contentText = segment.slice(separator + 4);
    const nameMatch = headerText.match(/name=\"([^\"]+)\"/i);
    const filenameMatch = headerText.match(/filename=\"([^\"]*)\"/i);
    const fieldName = nameMatch?.[1] ?? "";
    const contentBuffer = Buffer.from(contentText.replace(/\r\n$/, ""), "binary");

    if (fieldName === "path") {
      path = contentBuffer.toString("utf8").trim();
    } else if (fieldName === "file" || filenameMatch) {
      fileBuffer = contentBuffer;
      if (!path && filenameMatch?.[1]) {
        path = filenameMatch[1];
      }
    }
  }

  if (!path || !fileBuffer) {
    throw new AppError(400, "Multipart upload must include path and file.", "INVALID_MULTIPART");
  }

  return {
    path,
    contentBase64: fileBuffer.toString("base64"),
    sizeBytes: fileBuffer.byteLength
  };
}

minecraftController.patch(
  "/servers/:id/hostname",
  requireRole(["superadmin", "ops"]),
  validateParams(minecraftServerParamsSchema),
  validateBody(updateMinecraftHostnameSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const result = await updateMinecraftServerHostname(req.params.id, req.body.hostnameSlug);
    await writeAuditLog(req, {
      action: "minecraft.server.hostname",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "system",
      targetId: req.params.id,
      metadata: {
        hostname: result.server.hostname,
        hostnameSlug: result.server.hostnameSlug,
        dnsStatus: result.server.dnsStatus
      }
    });
    res.json(result);
  })
);

minecraftController.post(
  "/servers/:id/start",
  requireRole(["superadmin", "ops"]),
  validateParams(minecraftServerParamsSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const result = await startMinecraftServer(req.params.id);
    await writeAuditLog(req, {
      action: "minecraft.server.start",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "system",
      targetId: req.params.id
    });
    res.json(result);
  })
);

minecraftController.post(
  "/servers/:id/stop",
  requireRole(["superadmin", "ops"]),
  validateParams(minecraftServerParamsSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const result = await stopMinecraftServer(req.params.id);
    await writeAuditLog(req, {
      action: "minecraft.server.stop",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "system",
      targetId: req.params.id
    });
    res.json(result);
  })
);

minecraftController.post(
  "/servers/:id/restart",
  requireRole(["superadmin", "ops"]),
  validateParams(minecraftServerParamsSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const result = await restartMinecraftServer(req.params.id);
    await writeAuditLog(req, {
      action: "minecraft.server.restart",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "system",
      targetId: req.params.id
    });
    res.json(result);
  })
);

minecraftController.delete(
  "/servers/:id",
  requireRole(["superadmin"]),
  validateParams(minecraftServerParamsSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const parsedQuery = deleteMinecraftServerQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      throw new AppError(400, "Invalid query parameters.", "VALIDATION_ERROR", parsedQuery.error.flatten());
    }
    const result = await deleteMinecraftServer(req.params.id, parsedQuery.data);
    await writeAuditLog(req, {
      action: "minecraft.server.delete",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "system",
      targetId: req.params.id,
      metadata: {
        finalized: result.finalized,
        hardDeleteData: parsedQuery.data.hardDeleteData
      }
    });
    res.status(result.finalized ? 200 : 202).json(result);
  })
);

minecraftController.post(
  "/servers/:id/command",
  requireRole(["superadmin", "ops"]),
  validateParams(minecraftServerParamsSchema),
  validateBody(minecraftCommandSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const result = await enqueueMinecraftOperation(
      req.params.id,
      "command",
      { command: req.body.command },
      actor
    );
    await writeAuditLog(req, {
      action: "minecraft.server.command",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "system",
      targetId: req.params.id,
      metadata: { command: req.body.command, opId: result.operation.id }
    });
    res.status(result.pending ? 202 : 200).json(result);
  })
);

minecraftController.post(
  "/servers/:id/save",
  requireRole(["superadmin", "ops"]),
  validateParams(minecraftServerParamsSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const result = await enqueueMinecraftOperation(req.params.id, "save", {}, actor);
    await writeAuditLog(req, {
      action: "minecraft.server.save",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "system",
      targetId: req.params.id,
      metadata: { opId: result.operation.id }
    });
    res.status(result.pending ? 202 : 200).json(result);
  })
);

minecraftController.get(
  "/servers/:id/logs",
  validateParams(minecraftServerParamsSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const parsedQuery = minecraftLogsQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      throw new AppError(400, "Invalid query parameters.", "VALIDATION_ERROR", parsedQuery.error.flatten());
    }
    const tail = parsedQuery.data.tail ?? 200;
    const result = await enqueueMinecraftOperation(
      req.params.id,
      "logs",
      { tail },
      actor
    );
    await writeAuditLog(req, {
      action: "minecraft.server.logs",
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "system",
      targetId: req.params.id,
      metadata: { tail, opId: result.operation.id }
    });
    res.status(result.pending ? 202 : 200).json(result);
  })
);

minecraftController.get(
  "/servers/:id/operations/:opId",
  validateParams(minecraftOperationParamsSchema),
  asyncHandler(async (req, res) => {
    const result = await getMinecraftOperation(req.params.id, req.params.opId);
    res.json(result);
  })
);
