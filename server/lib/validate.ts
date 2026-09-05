/**
 * Input validation — ours, zero dependencies (TRD.md §6).
 *
 * Four properties matter more than the API surface:
 *
 *  1. WHITELIST, NOT BLACKLIST. Unknown keys are a 400. `role`, `status`,
 *     `risk_band` and `unit_price_cents` are not "filtered out" of a request
 *     body — they are never accepted, so mass assignment is impossible by
 *     construction rather than by remembering to strip them.
 *  2. COERCE THEN VALIDATE. Query strings arrive as text. `int()` parses and
 *     range-checks in one place, so no handler ever calls parseInt and forgets
 *     to check NaN.
 *  3. COLLECT ALL ERRORS. A failure returns every bad field at once, so the UI
 *     marks them in one pass instead of one round trip per field.
 *  4. BOUNDED BY DEFAULT. Every string has a maximum length and every array a
 *     maximum size, so an oversized payload is refused here rather than at the
 *     far end of the stack.
 *
 * `required` is carried in the TYPE, not just the value: `int({ required: true })`
 * has type `Rule<number, true>`. That is what lets `object()` hand a handler a
 * body whose required fields are known to be present, so no handler re-checks
 * something the validator already guaranteed.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Result plumbing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Errors are keyed by path RELATIVE to the rule that produced them. A scalar
 * reports under "", and its parent prefixes the key with the field name. That
 * is what lets a nested object or an array element report as `lines[2].qty`
 * without any rule knowing where it sits in the tree.
 */
export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: Record<string, string> };

export interface Rule<T, R extends boolean = boolean> {
  readonly required: R;
  parse(value: unknown): ValidationResult<T>;
}

const ok = <T>(value: T): ValidationResult<T> => ({ ok: true, value });
const fail = (message: string): ValidationResult<never> => ({ ok: false, errors: { "": message } });

function joinPath(parent: string, child: string): string {
  if (child === "") return parent;
  if (child.startsWith("[")) return `${parent}${child}`;
  return `${parent}.${child}`;
}

/** Absent means undefined, null, or the empty string a blank form field sends. */
const isAbsent = (value: unknown): boolean =>
  value === undefined || value === null || value === "";

interface Base<R extends boolean> {
  required?: R;
}

/** Every factory defaults to optional; only `required: true` is ever written out. */
const requiredness = <R extends boolean>(options: Base<R>): R => (options.required ?? false) as R;

/**
 * Coercion for the numeric rules. The empty string is rejected explicitly
 * because `Number("")` is 0 — so without this, a blank field arriving anywhere
 * `object()` does not already treat as absent (an array element, say) would
 * quietly become a valid zero.
 */
function toNumber(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text === "") return null;
  const parsed = Number(text);
  return Number.isNaN(parsed) ? null : parsed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scalars
// ─────────────────────────────────────────────────────────────────────────────

export interface StringOptions<R extends boolean> extends Base<R> {
  min?: number;
  /** Bounded by default: an unbounded text field is a denial-of-service knob. */
  max?: number;
  pattern?: RegExp;
  /** Whitespace is trimmed before every check unless explicitly disabled. */
  trim?: boolean;
}

export function string<R extends boolean = false>(
  options: StringOptions<R> = {},
): Rule<string, R> {
  const { min = 0, max = 1000, pattern, trim = true } = options;
  return {
    required: requiredness(options),
    parse(value) {
      if (typeof value !== "string") return fail("must be text");
      const text = trim ? value.trim() : value;
      if (text.length < min) {
        return fail(min === 1 ? "is required" : `must be at least ${min} characters`);
      }
      if (text.length > max) return fail(`must be at most ${max} characters`);
      if (pattern && !pattern.test(text)) return fail("is not in the expected format");
      return ok(text);
    },
  };
}

export interface IntOptions<R extends boolean> extends Base<R> {
  min?: number;
  max?: number;
}

export function int<R extends boolean = false>(options: IntOptions<R> = {}): Rule<number, R> {
  const { min, max } = options;
  return {
    required: requiredness(options),
    parse(value) {
      // Coerce first: a query string carries "42", a JSON body carries 42, and
      // the handler downstream should not have to care which it got.
      const parsed = toNumber(value);
      if (parsed === null || !Number.isFinite(parsed)) return fail("must be a number");
      if (!Number.isInteger(parsed)) return fail("must be a whole number");
      if (min !== undefined && parsed < min) return fail(`must be at least ${min}`);
      if (max !== undefined && parsed > max) return fail(`must be at most ${max}`);
      return ok(parsed);
    },
  };
}

export interface DecimalOptions<R extends boolean> extends Base<R> {
  min?: number;
  max?: number;
  /** Decimal places allowed. Discounts are NUMERIC(6,3), so scale 3. */
  scale?: number;
}

/**
 * Percentages and other exact decimals. `scale` is enforced rather than rounded
 * silently: a discount of 12.3456 is a client bug, and quietly accepting it
 * would store a value that no longer matches what the user was shown.
 */
export function decimal<R extends boolean = false>(
  options: DecimalOptions<R> = {},
): Rule<number, R> {
  const { min, max, scale = 3 } = options;
  return {
    required: requiredness(options),
    parse(value) {
      const parsed = toNumber(value);
      if (parsed === null || !Number.isFinite(parsed)) return fail("must be a number");
      if (min !== undefined && parsed < min) return fail(`must be at least ${min}`);
      if (max !== undefined && parsed > max) return fail(`must be at most ${max}`);
      if (decimalPlaces(parsed) > scale) return fail(`must have at most ${scale} decimal places`);
      return ok(parsed);
    },
  };
}

function decimalPlaces(value: number): number {
  const text = String(value);
  // Exponential notation from a very small number: treat as over-precise rather
  // than trying to count places in "1e-7".
  if (text.includes("e") || text.includes("E")) return Number.MAX_SAFE_INTEGER;
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

export function bool<R extends boolean = false>(options: Base<R> = {}): Rule<boolean, R> {
  return {
    required: requiredness(options),
    parse(value) {
      if (typeof value === "boolean") return ok(value);
      // Checkbox and query-string forms send text.
      if (value === "true") return ok(true);
      if (value === "false") return ok(false);
      return fail("must be true or false");
    },
  };
}

/**
 * The workhorse behind every CHECK-constrained column. Passing the allowed set
 * here means a status the database would reject never reaches it.
 */
export function oneOf<const T extends readonly string[], R extends boolean = false>(
  values: T,
  options: Base<R> = {},
): Rule<T[number], R> {
  return {
    required: requiredness(options),
    parse(value) {
      if (typeof value !== "string" || !values.includes(value)) {
        return fail(`must be one of: ${values.join(", ")}`);
      }
      return ok(value as T[number]);
    },
  };
}

/** ISO calendar date, returned as a string — dates cross the wire as text. */
export function date<R extends boolean = false>(options: Base<R> = {}): Rule<string, R> {
  return {
    required: requiredness(options),
    parse(value) {
      if (typeof value !== "string") return fail("must be a date");
      const text = value.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return fail("must be a date like 2026-09-05");
      const parsed = new Date(`${text}T00:00:00Z`);
      if (Number.isNaN(parsed.getTime())) return fail("is not a real date");
      // Catches 2026-02-31, which Date would otherwise roll forward silently.
      if (parsed.toISOString().slice(0, 10) !== text) return fail("is not a real date");
      return ok(text);
    },
  };
}

/**
 * Deliberately permissive. The only claim worth making about an email at the
 * validation layer is that it has a local part, an @, and a dotted domain —
 * anything stricter rejects addresses that are genuinely valid, and anything
 * looser is not worth checking. Real verification is delivery, which we do not
 * do (TRD.md §3).
 */
export function email<R extends boolean = false>(options: Base<R> = {}): Rule<string, R> {
  const inner = string({ min: 3, max: 254, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ });
  return {
    required: requiredness(options),
    parse(value) {
      const result = inner.parse(value);
      if (!result.ok) return fail("must be an email address");
      // Lowercased so the value matches the CITEXT column's own comparison.
      return ok(result.value.toLowerCase());
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Composites
// ─────────────────────────────────────────────────────────────────────────────

export interface ArrayOptions<R extends boolean> extends Base<R> {
  min?: number;
  /** Bounded by default, for the same reason strings are. */
  max?: number;
}

export function array<T, R extends boolean = false>(
  of: Rule<T>,
  options: ArrayOptions<R> = {},
): Rule<T[], R> {
  const { min = 0, max = 200 } = options;
  return {
    required: requiredness(options),
    parse(value) {
      if (!Array.isArray(value)) return fail("must be a list");
      if (value.length < min) return fail(`must have at least ${min} items`);
      if (value.length > max) return fail(`must have at most ${max} items`);

      const out: T[] = [];
      const errors: Record<string, string> = {};
      value.forEach((item, index) => {
        const result = of.parse(item);
        if (result.ok) {
          out.push(result.value);
        } else {
          for (const [key, message] of Object.entries(result.errors)) {
            errors[joinPath(`[${index}]`, key)] = message;
          }
        }
      });
      return Object.keys(errors).length > 0 ? { ok: false, errors } : ok(out);
    },
  };
}

export type Shape = Record<string, Rule<unknown>>;

/**
 * What a route handler actually gets: required fields present, optional ones
 * possibly absent. This is the payoff for tracking `required` in the type.
 */
export type Validated<S extends Shape> = {
  [K in keyof S as S[K]["required"] extends true ? K : never]: S[K] extends Rule<infer T>
    ? T
    : never;
} & {
  [K in keyof S as S[K]["required"] extends true ? never : K]?: S[K] extends Rule<infer T>
    ? T
    : never;
};

/**
 * The whitelist. A key that is not in the shape is a 400, not a silent ignore —
 * so a probe for `role` or `unit_price_cents` shows up in the logs as a failed
 * request instead of passing unnoticed.
 */
export function object<S extends Shape>(shape: S): Rule<Validated<S>, true> {
  return {
    required: true,
    parse(value) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return fail("must be an object");
      }
      const input = value as Record<string, unknown>;
      const errors: Record<string, string> = {};
      const out: Record<string, unknown> = {};

      for (const key of Object.keys(input)) {
        if (!Object.hasOwn(shape, key)) {
          errors[key] = "is not a field this endpoint accepts";
        }
      }

      for (const [key, rule] of Object.entries(shape)) {
        const raw = input[key];
        if (isAbsent(raw)) {
          // An absent optional field is omitted from the output entirely, so a
          // handler can tell "not sent" from "sent and empty".
          if (rule.required) errors[key] = "is required";
          continue;
        }
        const result = rule.parse(raw);
        if (result.ok) {
          out[key] = result.value;
        } else {
          for (const [childKey, message] of Object.entries(result.errors)) {
            errors[joinPath(key, childKey)] = message;
          }
        }
      }

      return Object.keys(errors).length > 0
        ? { ok: false, errors }
        : ok(out as Validated<S>);
    },
  };
}
