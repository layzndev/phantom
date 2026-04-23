import session from "express-session";
import { deleteAdminSessionRecord, findAdminSessionRecord, touchAdminSessionRecord, upsertAdminSessionRecord } from "../../db/sessionRepository.js";
import type { DbJsonInput } from "../../db/types.js";

type SessionData = session.SessionData & {
  admin?: {
    id: string;
    email: string;
    role: string;
  };
  security?: {
    ipAddress?: string;
    userAgent?: string;
  };
};

function sessionExpiresAt(sess: SessionData) {
  const expires = sess.cookie?.expires;
  if (expires) return new Date(expires);
  return new Date(Date.now() + 1000 * 60 * 60 * 8);
}

function serializeSession(sess: SessionData): DbJsonInput {
  return JSON.parse(JSON.stringify(sess)) as DbJsonInput;
}

export class PrismaAdminSessionStore extends session.Store {
  get(sid: string, callback: (err: unknown, session?: session.SessionData | null) => void) {
    findAdminSessionRecord(sid)
      .then((storedSession) => {
        if (!storedSession || storedSession.expiresAt <= new Date()) {
          callback(null, null);
          return;
        }

        callback(null, storedSession.data as unknown as session.SessionData);
      })
      .catch((error) => callback(error));
  }

  set(sid: string, sess: session.SessionData, callback?: (err?: unknown) => void) {
    const data = sess as SessionData;
    upsertAdminSessionRecord({
      id: sid,
      adminId: data.admin?.id,
      data: serializeSession(data),
      expiresAt: sessionExpiresAt(data),
      ipAddress: data.security?.ipAddress,
      userAgent: data.security?.userAgent
      })
      .then(() => callback?.())
      .catch((error) => callback?.(error));
  }

  destroy(sid: string, callback?: (err?: unknown) => void) {
    deleteAdminSessionRecord(sid)
      .then(() => callback?.())
      .catch((error) => callback?.(error));
  }

  touch(sid: string, sess: session.SessionData, callback?: () => void) {
    const data = sess as SessionData;
    touchAdminSessionRecord(sid, serializeSession(data), sessionExpiresAt(data))
      .then(() => callback?.())
      .catch(() => callback?.());
  }
}
