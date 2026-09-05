/**
 * The one error boundary. Every route's failure path ends here, so the wire
 * format of an error is defined in exactly one place (TRD.md §7).
 *
 * The rule: an `AppError` is something we meant to say, and its message is
 * safe to send. Anything else is a bug — logged with its stack server-side,
 * returned as a generic 500. No stack trace ever crosses the wire, in any
 * environment.
 */
import type { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import type { ApiError } from "../../shared/types.ts";

export function notFoundHandler(req: Request, res: Response): void {
  const body: ApiError = {
    error: { code: "NOT_FOUND", message: `No endpoint at ${req.method} ${req.path}.` },
  };
  res.status(404).json(body);
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  // Express identifies an error handler by its arity, so this parameter must
  // stay even though it is unused.
  _next: NextFunction,
): void {
  if (error instanceof AppError) {
    if (error.retryAfterSeconds !== undefined) {
      res.set("Retry-After", String(error.retryAfterSeconds));
    }
    const body: ApiError = {
      error: {
        code: error.code,
        message: error.message,
        ...(error.fields ? { fields: error.fields } : {}),
      },
    };
    res.status(error.status).json(body);
    return;
  }

  // A malformed JSON body surfaces as an express.json() SyntaxError. It is the
  // client's fault, not ours, so it is a 400 rather than a 500 — but it still
  // gets a generic message, because the parser's own text quotes the payload.
  if (error instanceof SyntaxError && "body" in error) {
    const body: ApiError = {
      error: { code: "VALIDATION_FAILED", message: "The request body is not valid JSON." },
    };
    res.status(400).json(body);
    return;
  }

  log.error("Unhandled error", error, { method: req.method, path: req.path });
  const body: ApiError = {
    error: { code: "INTERNAL", message: "Something went wrong on our end." },
  };
  res.status(500).json(body);
}
