/**
 * Wires the validator (lib/validate.ts) into Express.
 *
 * Applied to EVERY mutating route without exception — a route without
 * `validate()` fails review (TRD.md §6). The validated result replaces the raw
 * input, so a handler that reads `req.body` is reading the whitelisted object
 * and cannot accidentally see a field the schema does not declare.
 */
import type { NextFunction, Request, Response } from "express";
import { validationFailed } from "../lib/errors.ts";
import type { Rule, Shape, Validated } from "../lib/validate.ts";

/**
 * Errors from a nested rule arrive keyed by path (`lines[2].qty`), which is
 * exactly what the UI needs to mark the right field. The empty key — a failure
 * of the body as a whole, such as sending an array — is reported under a name
 * a form can display.
 */
function toFields(errors: Record<string, string>): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [key, message] of Object.entries(errors)) {
    fields[key === "" ? "_" : key] = message;
  }
  return fields;
}

export function validate<S extends Shape>(schema: Rule<Validated<S>, true>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    // A body-less POST is an empty object, not a validation crash; the schema's
    // own `required` rules then produce the real message.
    const result = schema.parse(req.body ?? {});
    if (!result.ok) return next(validationFailed(toFields(result.errors)));
    req.body = result.value;
    next();
  };
}

/**
 * Same treatment for query strings. Separate from `validate` because the source
 * differs, not the rules — `int()` already coerces "42" to 42, so a filter
 * schema reads identically to a body schema.
 */
export function validateQuery<S extends Shape>(schema: Rule<Validated<S>, true>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.parse(req.query ?? {});
    if (!result.ok) return next(validationFailed(toFields(result.errors)));
    // Express 4's `req.query` is a plain object and safe to replace; doing so
    // means a handler cannot reach an unvalidated parameter by accident.
    req.query = result.value as Request["query"];
    next();
  };
}
