import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

/**
 * A ~50-line router, rather than a dependency.
 *
 * We need three things: read the current path, navigate without a reload, and
 * match a couple of patterns with an :id segment. react-router solves a much
 * larger problem than we have. Per the dependency rule, we default to the
 * platform — this is the History API with a subscription.
 */

interface RouterCtx {
  path: string;
  navigate: (to: string, opts?: { replace?: boolean }) => void;
}

const Ctx = createContext<RouterCtx | null>(null);

export function useRouter(): RouterCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useRouter must be used inside <Router>");
  return ctx;
}

export function Router({ base = "", children }: { base?: string; children: ReactNode }) {
  const [path, setPath] = useState(() => stripBase(window.location.pathname, base));

  useEffect(() => {
    const onPop = () => setPath(stripBase(window.location.pathname, base));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [base]);

  const navigate = useCallback<RouterCtx["navigate"]>(
    (to, opts) => {
      const full = base + to;
      if (opts?.replace) window.history.replaceState({}, "", full);
      else window.history.pushState({}, "", full);
      setPath(to);
      window.scrollTo(0, 0);
    },
    [base],
  );

  const value = useMemo(() => ({ path, navigate }), [path, navigate]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function stripBase(pathname: string, base: string): string {
  const p = base && pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  return p === "" ? "/" : p;
}

/**
 * Matches "/quotations/:id" against "/quotations/1042".
 * Returns the captured params, or null when the pattern does not apply.
 */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const pp = pattern.split("/").filter(Boolean);
  const ap = path.split("/").filter(Boolean);
  if (pp.length !== ap.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < pp.length; i++) {
    const seg = pp[i]!;
    const actual = ap[i]!;
    if (seg.startsWith(":")) params[seg.slice(1)] = actual;
    else if (seg !== actual) return null;
  }
  return params;
}

/** Anchor that navigates without a full page load, but is still a real link. */
export function Link({
  to,
  className = "",
  children,
}: {
  to: string;
  className?: string;
  children: ReactNode;
}) {
  const { navigate } = useRouter();
  return (
    <a
      href={to}
      className={className}
      onClick={(e) => {
        // Let modified clicks open a new tab, as a real link should.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
