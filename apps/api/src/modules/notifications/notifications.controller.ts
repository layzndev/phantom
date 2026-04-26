import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { AppError } from "../../lib/appError.js";
import { validateParams } from "../../lib/validate.js";
import { requireAdmin } from "../../middleware/authMiddleware.js";
import {
  dismissSystemNotification,
  listSystemNotifications,
  markAllSystemNotificationsRead,
  markSystemNotificationRead
} from "./notifications.service.js";
import {
  notificationListQuerySchema,
  notificationParamsSchema
} from "./notifications.schema.js";

export const notificationsController = Router();

notificationsController.use(requireAdmin);

notificationsController.get(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = notificationListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(
        400,
        "Invalid query parameters.",
        "VALIDATION_ERROR",
        parsed.error.flatten()
      );
    }
    const { includeDismissed, limit } = parsed.data;
    const notifications = await listSystemNotifications({ includeDismissed, limit });
    res.json({ notifications });
  })
);

notificationsController.post(
  "/read-all",
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    res.json(await markAllSystemNotificationsRead(actor.id));
  })
);

notificationsController.post(
  "/:id/read",
  validateParams(notificationParamsSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const notification = await markSystemNotificationRead(req.params.id, actor.id);
    res.json({ notification });
  })
);

notificationsController.post(
  "/:id/dismiss",
  validateParams(notificationParamsSchema),
  asyncHandler(async (req, res) => {
    const actor = req.session.admin!;
    const notification = await dismissSystemNotification(req.params.id, actor.id);
    res.json({ notification });
  })
);
