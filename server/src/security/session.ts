import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { RequestHandler, Response } from "express";
import type { Pool } from "pg";
import { AppError } from "../errors.js";
import { readCookie } from "./cookies.js";

const COOKIE_NAME = "banking_app_session";
const ABSOLUTE_LIFETIME = 8 * 60 * 60 * 1000;
const IDLE_LIFETIME = 10 * 60 * 1000;

// requireSession only deletes a dead session when someone presents its token, and
// a closed tab never presents one again, so those rows need sweeping.
export const SWEEP_INTERVAL = 10 * 60 * 1000;

// Absolute expiry only, which is what sessions_expiry_idx serves. Idle sessions are
// left for their absolute expiry: requireSession rejects and deletes one the moment
// it goes idle anyway, and `OR last_activity_at < ...` could not use this index
// without a second one on a column written on almost every request.
export async function deleteExpiredSessions(pool: Pool): Promise<number> {
  const res = await pool.query("DELETE FROM sessions WHERE expires_at <= CURRENT_TIMESTAMP");
  return res.rowCount ?? 0;
}

function tokenHash(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

type SessionRow = {
  session_id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  last_activity_at: Date;
  expires_at: Date;
};

function clearCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: "lax", secure: false, path: "/" });
}

export function sessionSecurity(pool: Pool) {
  const requireSession: RequestHandler = async (req, res, next) => {
    try {
      const token = readCookie(req, COOKIE_NAME);
      if (!token) throw new AppError(401, "AUTHENTICATION_REQUIRED", "Please sign in to continue.");

      const result = await pool.query<SessionRow>(
        `SELECT s.id AS session_id, s.user_id, s.last_activity_at, s.expires_at,
                u.first_name, u.last_name
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = $1`,
        [tokenHash(token)],
      );
      const session = result.rows[0];
      if (!session) {
        clearCookie(res);
        throw new AppError(401, "AUTHENTICATION_REQUIRED", "Please sign in to continue.");
      }

      const now = Date.now();
      const expired = session.expires_at.getTime() <= now;
      const idle = session.last_activity_at.getTime() + IDLE_LIFETIME <= now;
      if (expired || idle) {
        await pool.query("DELETE FROM sessions WHERE id = $1", [session.session_id]);
        clearCookie(res);
        throw new AppError(
          401,
          "SESSION_EXPIRED",
          "You were signed out after being inactive for more than 10 minutes.",
        );
      }

      // Once a minute is enough. The idle window is ten minutes, and the alternative is
      // a row write on every authenticated request.
      if (session.last_activity_at.getTime() + 60_000 < now) {
        await pool.query("UPDATE sessions SET last_activity_at = CURRENT_TIMESTAMP WHERE id = $1", [
          session.session_id,
        ]);
      }

      req.authenticatedUser = {
        id: session.user_id,
        firstName: session.first_name,
        lastName: session.last_name,
      };
      req.sessionId = session.session_id;
      next();
    } catch (error) {
      next(error);
    }
  };

  async function createSession(userId: string, res: Response): Promise<void> {
    const token = randomBytes(32).toString("base64url");
    await pool.query(
      `INSERT INTO sessions(id, user_id, token_hash, last_activity_at, expires_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '8 hours')`,
      [randomUUID(), userId, tokenHash(token)],
    );
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      // Local HTTP only: Safari refuses a Secure cookie over http://localhost.
      secure: false,
      path: "/",
      maxAge: ABSOLUTE_LIFETIME,
    });
  }

  async function destroySession(token: string | undefined, res: Response): Promise<void> {
    if (token) await pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(token)]);
    clearCookie(res);
  }

  return { requireSession, createSession, destroySession, cookieName: COOKIE_NAME };
}
