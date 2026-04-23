import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import session from "express-session";
import { env } from "../config/env.js";
import { PrismaAdminSessionStore } from "../modules/auth/auth-session.store.js";

export const corsMiddleware = cors({
  origin: env.webOrigin,
  credentials: true
});

export const helmetMiddleware = helmet({
  crossOriginResourcePolicy: { policy: "same-site" }
});

export const authRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 25,
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
    sameSite: "strict",
    maxAge: 1000 * 60 * 60 * 8
  }
});
