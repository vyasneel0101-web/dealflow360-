/**
 * The two things every route needs, so neither gets reinvented per file.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ApiSuccess } from "../../shared/types.ts";

/**
 * Express 4 does not catch a rejected promise from an async handler: the
 * request hangs until it times out, which during a demo looks like the server
 * died. Wrapping forwards the rejection to the error middleware instead.
 */
export function asyncRoute(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

/** The uniform success envelope, `{ data: … }`, applied in one place. */
export function sendData<T>(res: Response, data: T, status = 200): void {
  const body: ApiSuccess<T> = { data };
  res.status(status).json(body);
}
