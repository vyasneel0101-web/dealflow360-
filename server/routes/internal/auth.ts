/**
 * Auth routes (A1.1). No SQL and no business logic here — a route reads the
 * request, calls a service, and shapes the response (TRD.md §2).
 */
import { Router } from "express";
import { email, object, string } from "../../lib/validate.ts";
import { validate } from "../../middleware/validate.ts";
import { rateLimit } from "../../middleware/rateLimit.ts";
import { currentUser, requireInternal, userAgentOf } from "../../middleware/auth.ts";
import * as authService from "../../services/auth.ts";
import { asyncRoute, sendData } from "../helpers.ts";

/**
 * `role` is deliberately absent from both schemas. It is not filtered out of
 * the body — it is never accepted, so a request carrying it gets a 400 naming
 * the field rather than silently creating an admin (TRD.md §3).
 */
const SignupSchema = object({
  email: email({ required: true }),
  // 12 characters, no composition rules. NIST's position, and the honest one:
  // length is what resists guessing, while "one symbol, one digit" mostly
  // produces Password1! and a sticky note.
  password: string({ min: 12, max: 200, required: true, trim: false }),
  full_name: string({ min: 1, max: 120, required: true }),
});

const LoginSchema = object({
  email: email({ required: true }),
  password: string({ min: 1, max: 200, required: true, trim: false }),
});

/** Per IP and per email, so neither one host nor one account can be walked. */
const loginLimiter = rateLimit({
  scope: "login",
  max: 10,
  windowMs: 5 * 60 * 1000,
  identity: (req) => (typeof req.body?.email === "string" ? req.body.email : undefined),
});

export const authRouter: Router = Router();

authRouter.post(
  "/signup",
  rateLimit({ scope: "signup", max: 5, windowMs: 60 * 60 * 1000 }),
  validate(SignupSchema),
  asyncRoute(async (req, res) => {
    const { email: address, password, full_name } = req.body;
    const result = await authService.signup(
      { email: address, password, full_name },
      userAgentOf(req),
    );
    sendData(res, result, 201);
  }),
);

authRouter.post(
  "/login",
  // Validation runs BEFORE the limiter so the limiter's identity key reads a
  // normalised email — otherwise "Bob@x.com" and "bob@x.com" get separate
  // budgets, and the per-identity limit is trivially bypassed by changing case.
  validate(LoginSchema),
  loginLimiter,
  asyncRoute(async (req, res) => {
    const { email: address, password } = req.body;
    sendData(res, await authService.login({ email: address, password }, userAgentOf(req)));
  }),
);

authRouter.post(
  "/logout",
  requireInternal,
  asyncRoute(async (req, res) => {
    if (req.sessionToken) await authService.logout(req.sessionToken);
    res.status(204).end();
  }),
);

authRouter.get(
  "/me",
  requireInternal,
  asyncRoute(async (req, res) => {
    // Already resolved by the middleware; re-reading the user here would be a
    // second query for a value we hold.
    sendData(res, currentUser(req));
  }),
);
