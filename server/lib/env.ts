/**
 * Environment configuration.
 *
 * No dotenv dependency: Node's own `process.loadEnvFile` reads `.env` (added in
 * Node 20.12 / 22). One fewer package to justify, and the file format is the
 * same one every developer already expects.
 *
 * Every value is read once, here, and validated at import time. A missing
 * DATABASE_URL should stop the process at boot with a sentence a human can act
 * on — not surface as a connection error on the first request during a demo.
 */
import process from "node:process";

try {
  process.loadEnvFile();
} catch {
  // No .env file. Legitimate in production, where the environment is set by the
  // platform. If a required variable is genuinely absent, the checks below say
  // exactly which one.
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer, got "${raw}".`);
  }
  return parsed;
}

export const env = {
  databaseUrl: required("DATABASE_URL"),
  port: int("PORT", 3000),
  nodeEnv: process.env.NODE_ENV ?? "development",

  /** Internal sessions are long enough for a working day (TRD.md §3). */
  sessionTtlHours: int("SESSION_TTL_HOURS", 12),
  /** Portal sessions are deliberately shorter — a customer's device is not ours. */
  portalSessionTtlHours: int("PORTAL_SESSION_TTL_HOURS", 2),
  /** A leaked magic link is one document for one day, not an account. */
  magicLinkTtlHours: int("MAGIC_LINK_TTL_HOURS", 24),
} as const;

export const isProduction = env.nodeEnv === "production";
