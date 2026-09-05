/**
 * Structured JSON logging to stdout. No logging dependency: one function that
 * writes a line of JSON is the whole requirement, and anything more would be a
 * package to justify.
 *
 * The part that earns its place is the redaction list. Passwords, tokens and
 * hashes must never reach a log file, and "remember not to log it" is not a
 * control — a nested `user` object logged for context is exactly how a
 * password_hash ends up on disk. So redaction happens on the way out, by key
 * name, recursively.
 */

const REDACTED_KEYS = new Set([
  "password",
  "password_hash",
  "passwordHash",
  "token",
  "token_hash",
  "tokenHash",
  "authorization",
  "cookie",
  "secret",
]);

type Level = "info" | "warn" | "error";

function redact(value: unknown, depth = 0): unknown {
  // A cycle or a deeply nested structure should not hang the logger.
  if (depth > 6) return "[deep]";
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = REDACTED_KEYS.has(key.toLowerCase()) ? "[redacted]" : redact(child, depth + 1);
    }
    return out;
  }
  return value;
}

function emit(level: Level, message: string, context?: Record<string, unknown>): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
    ...(context ? (redact(context) as Record<string, unknown>) : {}),
  });
  if (level === "error") process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const log = {
  info: (message: string, context?: Record<string, unknown>) => emit("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) => emit("warn", message, context),
  /**
   * The only place a stack trace is ever written, and it is written here —
   * server-side, to stderr. No stack ever crosses the wire (TRD.md §7).
   */
  error: (message: string, error?: unknown, context?: Record<string, unknown>) =>
    emit("error", message, {
      ...context,
      ...(error instanceof Error
        ? { error: error.message, stack: error.stack }
        : error !== undefined
          ? { error: String(error) }
          : {}),
    }),
};
