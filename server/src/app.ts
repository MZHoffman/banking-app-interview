import { randomUUID } from "node:crypto";
import cookieParser from "cookie-parser";
import express, { type RequestHandler } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import helmet from "helmet";
import type { Pool } from "pg";
import { z } from "zod";
import { config } from "./config.js";
import { AppError, errorHandler, notFoundHandler } from "./errors.js";
import { createMoneyModule } from "./money/module.js";
import { readCookie } from "./security/cookies.js";
import { hashPassword, verifyPassword } from "./security/password.js";
import { sessionSecurity } from "./security/session.js";

const signInSchema = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
    password: z.string().min(1).max(256),
  })
  .strict();

const operationSchema = z
  .object({
    amount: z.string().min(1).max(40),
    idempotencyKey: z.uuid(),
  })
  .strict();

// The account-number format at the trust boundary. client/src/account.ts repeats it
// so the transfer form fails fast, and 001_initial_schema.sql has it as a CHECK so a
// malformed number cannot be stored. Three copies, because a lenient client is a
// cosmetic bug and a lenient server is a hole.
const transferPreviewSchema = z
  .object({
    amount: z.string().min(1).max(40),
    recipientAccountNumber: z.string().regex(/^[1-9][0-9]{4}$/),
  })
  .strict();

const transferSchema = transferPreviewSchema.extend({ idempotencyKey: z.uuid() }).strict();

function asyncRoute(handler: RequestHandler): RequestHandler {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export async function createApp(pool: Pool) {
  const app = express();
  const sessions = sessionSecurity(pool);
  const money = createMoneyModule(pool);
  // Unknown emails are checked against a throwaway digest so sign-in does the same
  // scrypt work either way and its timing gives nothing away about which emails exist.
  const decoyDigest = await hashPassword(randomUUID());

  app.disable("x-powered-by");
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.setHeader("X-Request-ID", req.requestId);
    const started = performance.now();
    res.on("finish", () => {
      const matched = req.route as { path?: string } | undefined;
      const route = matched?.path ? `${req.baseUrl}${matched.path}` : req.path;
      console.info(
        JSON.stringify({
          requestId: req.requestId,
          method: req.method,
          route,
          status: res.statusCode,
          durationMs: Math.round(performance.now() - started),
        }),
      );
    });
    next();
  });

  app.use(helmet({ strictTransportSecurity: false })); // HSTS is omitted because the app is served over local HTTP.
  app.use(express.json({ limit: "20kb" }));
  app.use(cookieParser());

  app.use((req, _res, next) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      const origin = req.get("Origin");
      if (origin !== config.allowedOrigin) {
        next(new AppError(403, "AUTHENTICATION_REQUIRED", "The request origin is not allowed."));
        return;
      }
    }
    next();
  });

  const signInLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const body = req.body as { email?: unknown } | undefined;
      const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "unknown";
      return `${ipKeyGenerator(req.ip ?? "127.0.0.1")}:${email}`;
    },
    handler: (_req, _res, next) =>
      next(new AppError(429, "RATE_LIMITED", "Too many sign-in attempts. Please try again later.")),
  });

  const transferLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.authenticatedUser?.id ?? ipKeyGenerator(req.ip ?? "127.0.0.1"),
    handler: (_req, _res, next) =>
      next(new AppError(429, "RATE_LIMITED", "Too many transfer attempts. Please try again shortly.")),
  });

  app.post(
    "/api/auth/sign-in",
    signInLimiter,
    asyncRoute(async (req, res) => {
      const input = signInSchema.parse(req.body);
      const result = await pool.query<{
        id: string;
        first_name: string;
        last_name: string;
        password_digest: string;
      }>("SELECT id, first_name, last_name, password_digest FROM users WHERE email = $1", [input.email]);
      const user = result.rows[0];
      const valid = await verifyPassword(input.password, user?.password_digest ?? decoyDigest);
      if (!user || !valid) {
        throw new AppError(401, "AUTHENTICATION_FAILED", "The email or password is incorrect.");
      }
      await sessions.createSession(user.id, res);
      res.json({ user: { firstName: user.first_name, lastName: user.last_name } });
    }),
  );

  app.post(
    "/api/auth/sign-out",
    asyncRoute(async (req, res) => {
      const token = readCookie(req, sessions.cookieName);
      await sessions.destroySession(token, res);
      res.status(204).end();
    }),
  );

  app.get("/api/auth/session", sessions.requireSession, (req, res) => {
    const user = req.authenticatedUser!;
    res.json({ user: { firstName: user.firstName, lastName: user.lastName } });
  });

  app.post("/api/auth/heartbeat", sessions.requireSession, (_req, res) => res.status(204).end());

  app.get(
    "/api/account",
    sessions.requireSession,
    asyncRoute(async (req, res) => {
      const result = await pool.query<{
        account_number: string;
        balance_minor: string;
        first_name: string;
        last_name: string;
      }>(
        `SELECT a.account_number, a.balance_minor, u.first_name, u.last_name
       FROM accounts a JOIN users u ON u.id = a.user_id WHERE a.user_id = $1`,
        [req.authenticatedUser!.id],
      );
      const account = result.rows[0];
      if (!account) throw new AppError(404, "NOT_FOUND", "The account could not be found.");
      res.json({
        account: {
          holderName: `${account.first_name} ${account.last_name}`,
          accountNumber: account.account_number,
          balanceMinor: account.balance_minor,
        },
      });
    }),
  );

  app.post(
    "/api/deposits",
    sessions.requireSession,
    asyncRoute(async (req, res) => {
      const input = operationSchema.parse(req.body);
      const result = await money.deposit({ userId: req.authenticatedUser!.id, ...input });
      res.json({ result });
    }),
  );

  app.post(
    "/api/withdrawals",
    sessions.requireSession,
    asyncRoute(async (req, res) => {
      const input = operationSchema.parse(req.body);
      const result = await money.withdraw({ userId: req.authenticatedUser!.id, ...input });
      res.json({ result });
    }),
  );

  app.post(
    "/api/transfers/preview",
    sessions.requireSession,
    transferLimiter,
    asyncRoute(async (req, res) => {
      const input = transferPreviewSchema.parse(req.body);
      const preview = await money.previewTransfer({ userId: req.authenticatedUser!.id, ...input });
      res.json({ preview });
    }),
  );

  app.post(
    "/api/transfers",
    sessions.requireSession,
    transferLimiter,
    asyncRoute(async (req, res) => {
      const input = transferSchema.parse(req.body);
      const result = await money.transfer({ userId: req.authenticatedUser!.id, ...input });
      res.json({ result });
    }),
  );

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
