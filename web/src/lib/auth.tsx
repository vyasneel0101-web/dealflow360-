import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { AuthResponse, LoginRequest, Role, SignupRequest, User } from "@shared/types";
import { api, setToken, getToken } from "./api";

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (body: LoginRequest) => Promise<void>;
  signup: (body: SignupRequest) => Promise<void>;
  logout: () => Promise<void>;
  /** Mirrors the server-side check. The UI hides what a role cannot do; the
   *  server refuses it regardless — this is convenience, never the boundary. */
  can: (...roles: Role[]) => boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore the session on load. A stored token may be expired or revoked, in
  // which case /auth/me returns 401 and the api layer clears it for us.
  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api
      .get<User>("/auth/me")
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (body: LoginRequest) => {
    const res = await api.post<AuthResponse>("/auth/login", body);
    setToken(res.token);
    setUser(res.user);
  }, []);

  const signup = useCallback(async (body: SignupRequest) => {
    const res = await api.post<AuthResponse>("/auth/signup", body);
    setToken(res.token);
    setUser(res.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } finally {
      // Clear locally even if the call fails — the user asked to leave.
      setToken(null);
      setUser(null);
    }
  }, []);

  const can = useCallback(
    (...roles: Role[]) => (user ? roles.includes(user.role) : false),
    [user],
  );

  const value = useMemo(
    () => ({ user, loading, login, signup, logout, can }),
    [user, loading, login, signup, logout, can],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
