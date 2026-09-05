/**
 * The one error vocabulary the API speaks.
 *
 * Every code here maps to exactly one HTTP status and one `ApiErrorCode` from
 * `shared/types.ts`, so a client can branch on `code` without parsing prose.
 *
 * The rule that matters: 404 is returned both for "does not exist" and for
 * "exists but is not yours", and the two are never distinguished. Distinguishing
 * them turns any id-taking endpoint into an enumeration oracle (TRD.md §4).
 */
import type { ApiErrorCode } from "../../shared/types.ts";

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  STATE_CONFLICT: 409,
  BUSINESS_RULE: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

/**
 * An error we meant to produce. Anything thrown that is NOT an AppError is a
 * bug, and the error middleware treats it as one: logged with its stack
 * server-side, returned as a generic 500. No stack trace ever crosses the wire.
 */
export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly fields: Record<string, string> | undefined;
  /** Sent as a `Retry-After` header on 429. */
  readonly retryAfterSeconds: number | undefined;

  constructor(
    code: ApiErrorCode,
    message: string,
    options: { fields?: Record<string, string>; retryAfterSeconds?: number } = {},
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.fields = options.fields;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

/** 400 — carries every invalid field at once, so the UI marks them in one pass. */
export const validationFailed = (fields: Record<string, string>): AppError =>
  new AppError("VALIDATION_FAILED", "Some fields need attention.", { fields });

/** 401 — no session, or one that is expired or revoked. */
export const unauthenticated = (message = "Sign in to continue."): AppError =>
  new AppError("UNAUTHENTICATED", message);

/** 403 — a valid session, but this role may not do this. */
export const forbidden = (message = "You do not have access to that."): AppError =>
  new AppError("FORBIDDEN", message);

/** 404 — absent, or not yours. Deliberately the same answer for both. */
export const notFound = (message = "Not found."): AppError =>
  new AppError("NOT_FOUND", message);

/** 409 — an illegal state transition, or insufficient stock. */
export const stateConflict = (message: string): AppError =>
  new AppError("STATE_CONFLICT", message);

/** 422 — well-formed and permitted, but a business rule says no. */
export const businessRule = (message: string): AppError =>
  new AppError("BUSINESS_RULE", message);

export const rateLimited = (retryAfterSeconds: number): AppError =>
  new AppError("RATE_LIMITED", "Too many attempts. Try again shortly.", { retryAfterSeconds });
