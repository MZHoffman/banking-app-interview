import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";

export type ErrorCode =
  | "AUTHENTICATION_FAILED"
  | "INTERNAL_ERROR"
  | "AUTHENTICATION_REQUIRED"
  | "SESSION_EXPIRED"
  | "VALIDATION_ERROR"
  | "RECIPIENT_UNAVAILABLE"
  | "INSUFFICIENT_FUNDS"
  | "IDEMPOTENCY_CONFLICT"
  | "RATE_LIMITED"
  | "NOT_FOUND";

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new AppError(404, "NOT_FOUND", "The requested resource was not found."));
};

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  // Every failure carries its request id, so one number is enough to find the log
  // line. The id is assigned before any routing or lookup, so it gives nothing away.
  const fail = (status: number, code: ErrorCode, message: string, fields?: Record<string, string>) => {
    res.status(status).json({
      error: { code, message, ...(fields ? { fields } : {}), requestId: req.requestId },
    });
  };

  if (error instanceof SyntaxError && "body" in error) {
    fail(400, "VALIDATION_ERROR", "The request body must contain valid JSON.");
    return;
  }

  if (error instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of error.issues) {
      const field = issue.path[0];
      if (typeof field === "string" && !fields[field]) fields[field] = issue.message;
    }
    fail(400, "VALIDATION_ERROR", "Please correct the highlighted fields.", fields);
    return;
  }

  if (error instanceof AppError) {
    fail(error.status, error.code, error.message, error.fields);
    return;
  }

  console.error(`[${req.requestId}] Unexpected server error`, error);
  fail(500, "INTERNAL_ERROR", "Something went wrong. Please try again.");
};
