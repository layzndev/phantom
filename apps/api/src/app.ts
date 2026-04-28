import cookieParser from "cookie-parser";
import express from "express";
import morgan from "morgan";
import { auditController } from "./modules/audit/audit.controller.js";
import { authController } from "./modules/auth/auth.controller.js";
import { minecraftController } from "./modules/minecraft/minecraft.controller.js";
import { minecraftRuntimeController } from "./modules/minecraft/minecraft.runtime.controller.js";
import { incidentsController } from "./modules/incidents/incidents.controller.js";
import { nodesController } from "./modules/nodes/nodes.controller.js";
import { nodesRuntimeController } from "./modules/nodes/nodes.runtime.controller.js";
import { notificationsController } from "./modules/notifications/notifications.controller.js";
import { platformController } from "./modules/platform/platform.controller.js";
import { platformAdminController } from "./modules/platform/platform.admin.controller.js";
import { workloadsController } from "./modules/workloads/workloads.controller.js";
import { workloadsRuntimeController } from "./modules/workloads/workloads.runtime.controller.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import {
  requireAllowedAdminIp,
  requireAllowedRuntimeIp
} from "./middleware/ipAccessControl.js";
import { guardController } from "./modules/guard/guard.controller.js";
import { guardRuntimeController } from "./modules/guard/guard.runtime.controller.js";
import { requestContext } from "./middleware/requestContext.js";
import { adminSession, corsMiddleware, helmetMiddleware } from "./middleware/security.js";
import { env } from "./config/env.js";

export function createApp() {
  const app = express();

  app.set("trust proxy", env.trustProxy);
  app.use(requestContext);
  app.use(helmetMiddleware);
  app.use(corsMiddleware);
  app.options("*", corsMiddleware);
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(adminSession);
  app.use(morgan(":method :url :status :response-time ms :req[x-request-id]"));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "phantom-api" });
  });

  // Admin control plane — locked down to ADMIN_IP_ALLOWLIST (when set).
  app.use("/auth", requireAllowedAdminIp, authController);
  app.use("/nodes", requireAllowedAdminIp, nodesController);
  app.use("/workloads", requireAllowedAdminIp, workloadsController);
  app.use("/minecraft", requireAllowedAdminIp, minecraftController);
  app.use("/incidents", requireAllowedAdminIp, incidentsController);
  app.use("/notifications", requireAllowedAdminIp, notificationsController);
  app.use("/audit-logs", requireAllowedAdminIp, auditController);
  app.use("/guard", requireAllowedAdminIp, guardController);
  app.use("/platform-admin", requireAllowedAdminIp, platformAdminController);

  // Machine-to-machine surface consumed by the Hosting backend (Nebula).
  // Auth is a bearer platform token, NOT an admin session — it intentionally
  // does NOT sit behind the admin IP allowlist (the Hosting backend will
  // typically run on a different network).
  app.use("/platform", platformController);

  // Runtime / agent channel — locked down to RUNTIME_IP_ALLOWLIST (when set)
  // in addition to the per-request bearer token check inside each route.
  app.use("/runtime/nodes", requireAllowedRuntimeIp, nodesRuntimeController);
  app.use("/runtime/workloads", requireAllowedRuntimeIp, workloadsRuntimeController);
  app.use("/runtime/minecraft", requireAllowedRuntimeIp, minecraftRuntimeController);
  app.use("/runtime/guard", requireAllowedRuntimeIp, guardRuntimeController);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
