/**
 * The Express application, assembled but not listening.
 *
 * Kept separate from `index.ts` so tests can mount the real app — the real
 * middleware chain, the real error boundary — without binding a port or
 * needing a free one.
 */
import express, { type Express } from "express";
import { errorHandler, notFoundHandler } from "./middleware/error.ts";
import { authRouter } from "./routes/internal/auth.ts";
import { catalogueRouter } from "./routes/internal/catalogue.ts";

export function createApp(): Express {
  const app = express();

  // `req.ip` is the socket address unless a proxy is trusted. We deliberately
  // do NOT trust proxy headers: an attacker who can set X-Forwarded-For would
  // otherwise get a fresh rate-limit budget per forged address.
  app.set("trust proxy", false);
  app.disable("x-powered-by");

  // Bounded, for the same reason every string in the validator is bounded.
  app.use(express.json({ limit: "256kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ data: { status: "ok" } });
  });

  app.use("/api/auth", authRouter);
  app.use("/api", catalogueRouter);

  // Anything under /api that matched no route is a 404 in the API's own error
  // shape, not Express's HTML page.
  app.use("/api", notFoundHandler);
  app.use(errorHandler);

  return app;
}
