import type { NextFunction, Request, Response } from "express";
import { isAppError } from "../lib/appError.js";
import { writeCriticalErrorAuditLog } from "../modules/audit/audit.service.js";

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: "Not found.", code: "NOT_FOUND", requestId: _req.requestId });
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  if (isAppError(error)) {
    res.status(error.statusCode).json({
      error: error.message,
      code: error.code,
      details: error.details,
      requestId: req.requestId
    });
    return;
  }

  console.error(error);
  void writeCriticalErrorAuditLog(req, error);
  res.status(500).json({ error: "Internal server error.", code: "INTERNAL_ERROR", requestId: req.requestId });
}
