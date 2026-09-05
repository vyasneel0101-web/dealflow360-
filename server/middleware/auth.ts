/**
 * The two realms, as middleware.
 *
 * `requireInternal` looks only in `sessions`; `requirePortal` looks only in
 * `portal_sessions`. A portal token presented to an internal endpoint is not
 * "a user with the wrong role" — it is not a user at all, because nothing in
 * the internal realm can resolve it. That is PS §7's "real, separate,
 * restricted view" expressed as code rather than as a label.
 *
 * The two identities land on different request properties and have disjoint
 * types, so TypeScript will not let one stand in for the other either.
 */
import type { NextFunction, Request, Response } from "express";
import { forbidden, unauthenticated } from "../lib/errors.ts";
import * as authService from "../services/auth.ts";
import type { Contact, Id, Role, User } from "../../shared/types.ts";
import * as contacts from "../repositories/contacts.ts";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by requireInternal, and by nothing else. */
      user?: User;
      /** Set by requirePortal, and by nothing else. */
      contact?: Contact;
      /** The single quotation a portal session is scoped to. */
      portalQuotationId?: Id;
      /** Kept so logout can revoke the exact session that made the request. */
      sessionToken?: string;
    }
  }
}

/** `Authorization: Bearer <token>`, or null. Never throws on a malformed header. */
export function bearerToken(req: Request): string | null {
  const header = req.get("authorization");
  if (!header) return null;
  const [scheme, ...rest] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer") return null;
  const token = rest.join(" ").trim();
  return token.length > 0 ? token : null;
}

const userAgentOf = (req: Request): string | null => req.get("user-agent")?.slice(0, 500) ?? null;

export { userAgentOf };

export async function requireInternal(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = bearerToken(req);
    if (token === null) return next(unauthenticated());

    const user = await authService.resolveInternalSession(token);
    if (user === null) return next(unauthenticated("Your session has expired. Sign in again."));

    req.user = user;
    req.sessionToken = token;
    next();
  } catch (error) {
    next(error);
  }
}

export async function requirePortal(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = bearerToken(req);
    if (token === null) return next(unauthenticated());

    const session = await authService.resolvePortalSession(token);
    if (session === null) return next(unauthenticated("This link has expired."));

    const contact = await contacts.findById(session.contact_id);
    if (contact === null) return next(unauthenticated("This link is no longer valid."));

    req.contact = contact;
    if (session.quotation_id !== null) req.portalQuotationId = session.quotation_id;
    req.sessionToken = token;
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Role gate, per the PRD §3 matrix. Always used AFTER requireInternal — a
 * request with no user reaching here is a wiring bug, and it fails closed as a
 * 401 rather than quietly allowing anything.
 */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user) return next(unauthenticated());
    if (!roles.includes(user.role)) return next(forbidden());
    next();
  };
}

/**
 * Non-null accessors for handlers running behind the middleware above. Without
 * these every handler would open with an `if (!req.user) throw` that can never
 * fire, and the noise would make the checks that DO matter harder to see.
 */
export function currentUser(req: Request): User {
  const user = req.user;
  if (!user) throw unauthenticated();
  return user;
}

export function currentContact(req: Request): Contact {
  const contact = req.contact;
  if (!contact) throw unauthenticated();
  return contact;
}
