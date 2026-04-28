import type { NextFunction, Request, Response } from "express";
import { authenticatePlatformToken } from "../modules/platform/platform.tokens.service.js";

declare module "express-serve-static-core" {
  interface Request {
    platformToken?: {
      id: string;
      name: string;
      scopes: string[];
    };
  }
}

/**
 * Authenticate calls to the platform API surface using a machine-to-machine
 * bearer token (`Authorization: Bearer phs_live_…`). Tokens are minted in
 * the Phantom admin panel and held by the Hosting backend (Nebula) — they
 * are NOT issued to end customers.
 */
export async function requirePlatformToken(req: Request, res: Response, next: NextFunction) {
  try {
    const token = await authenticatePlatformToken(req.headers["authorization"] as string | undefined);
    if (!token) {
      res.status(401).json({ error: "Platform token required.", code: "PLATFORM_AUTH_REQUIRED" });
      return;
    }
    req.platformToken = token;
    next();
  } catch (error) {
    console.error("[platform] token authentication error", error);
    res.status(500).json({ error: "Platform authentication failed." });
  }
}
