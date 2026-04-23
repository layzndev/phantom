import type { NextFunction, Request, Response } from "express";

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session.admin) {
    res.status(401).json({ error: "Admin authentication required." });
    return;
  }

  next();
}

export function requireRole(roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.session.admin || !roles.includes(req.session.admin.role)) {
      res.status(403).json({ error: "Insufficient admin permissions." });
      return;
    }

    next();
  };
}
