import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import session from "express-session";
import { env } from "../config/env.js";
import { PrismaAdminSessionStore } from "../modules/auth/auth-session.store.js";

export const corsMiddleware = cors({
  origin(origin, callback) {
    if (!origin || env.corsOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error("CORS origin is not allowed."));
  },
  credentials: true
});

export const helmetMiddleware = helmet({
  // Conservative CSP — same-origin only for everything except inline styles
  // (Next.js statically generated HTML uses a few inline <style> blocks).
  contentSecurityPolicy: env.isProduction
    ? {
        useDefaults: true,
        directives: {
          "default-src": ["'self'"],
          "script-src": ["'self'"],
          "style-src": ["'self'", "'unsafe-inline'"],
          "img-src": ["'self'", "data:"],
          "connect-src": ["'self'", ...env.corsOrigins],
          "object-src": ["'none'"],
          "frame-ancestors": ["'none'"],
          "base-uri": ["'self'"],
          "form-action": ["'self'"]
        }
      }
    : false,
  crossOriginResourcePolicy: { policy: "same-site" },
  crossOriginOpenerPolicy: { policy: "same-origin" },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  // HSTS only in production over TLS — sending it in dev would persist on
  // the browser and break local non-https setups.
  strictTransportSecurity: env.isProduction
    ? { maxAge: env.hstsMaxAgeSeconds, includeSubDomains: true, preload: true }
    : false,
  hidePoweredBy: true,
  noSniff: true,
  frameguard: { action: "deny" }
});

export const authRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  // Stricter than before: 10 attempts per IP per 10 minutes. The per-IP
  // brute-force tracker (loginIpThrottle) and per-account lockout add
  // additional layers.
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false
});

export const adminSession = session({
  name: "phantom.sid",
  store: new PrismaAdminSessionStore(),
  secret: env.sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: env.cookieSameSite,
    maxAge: 1000 * 60 * 60 * 8
  }
});
