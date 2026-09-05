import type { ApiError, ApiSuccess } from "@shared/types";

/**
 * The single HTTP boundary for the internal app.
 *
 * Two properties matter more than the surface:
 *  1. `fields` from a 400 is preserved, so a form can mark every invalid field
 *     at once rather than one per round trip (TRD.md §6).
 *  2. Nothing here ever surfaces a raw status code or stack to the user. The
 *     server never sends one, and this layer would not display it if it did.
 */

const TOKEN_KEY = "dealflow.token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode — session simply does not persist across reloads */
  }
}

export class ApiRequestError extends Error {
  readonly code: ApiError["error"]["code"];
  readonly fields: Record<string, string>;
  readonly status: number;

  constructor(status: number, body: ApiError) {
    super(body.error.message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = body.error.code;
    this.fields = body.error.fields ?? {};
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    // Network failure, not an API error — say so in plain language.
    throw new ApiRequestError(0, {
      error: { code: "INTERNAL", message: "Could not reach the server. Check that it is running." },
    });
  }

  if (res.status === 204) return undefined as T;

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new ApiRequestError(res.status, {
      error: { code: "INTERNAL", message: "The server returned an unreadable response." },
    });
  }

  if (!res.ok) {
    const err = payload as ApiError;
    // An expired or revoked session drops the token so the app returns to login
    // rather than looping on 401s.
    if (res.status === 401) setToken(null);
    throw new ApiRequestError(res.status, err);
  }

  return (payload as ApiSuccess<T>).data;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};
