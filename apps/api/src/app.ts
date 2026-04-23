import cookieParser from "cookie-parser";
import express from "express";
import morgan from "morgan";
import { auditController } from "./modules/audit/audit.controller.js";
import { authController } from "./modules/auth/auth.controller.js";
import { nodesController } from "./modules/nodes/nodes.controller.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
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

  app.use("/auth", authController);
  app.use("/nodes", nodesController);
  app.use("/audit-logs", auditController);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
