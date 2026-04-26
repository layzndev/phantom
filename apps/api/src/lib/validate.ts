import type { NextFunction, Request, Response } from "express";
import type { ZodSchema } from "zod";
import { AppError } from "./appError.js";

export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      const flattened = parsed.error.flatten();
      console.warn("[validate] body validation failed", {
        method: req.method,
        path: req.originalUrl,
        fieldErrors: flattened.fieldErrors,
        formErrors: flattened.formErrors
      });
      next(new AppError(400, "Invalid request payload.", "VALIDATION_ERROR", flattened));
      return;
    }

    req.body = parsed.data;
    next();
  };
}

export function validateParams<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.params);
    if (!parsed.success) {
      next(new AppError(400, "Invalid route parameters.", "VALIDATION_ERROR", parsed.error.flatten()));
      return;
    }

    req.params = parsed.data as Record<string, string>;
    next();
  };
}
