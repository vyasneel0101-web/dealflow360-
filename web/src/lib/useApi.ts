import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiRequestError } from "./api";

/**
 * Data fetching, in about sixty lines rather than a query library.
 *
 * We need four things: fetch on mount, refetch on demand, a loading state that
 * distinguishes first load from refresh, and an error we can render. React
 * Query solves a much larger problem than we have, and per the dependency rule
 * we default to the platform.
 */
export interface Resource<T> {
  data: T | null;
  /** True only on the FIRST load. A refetch keeps the old data on screen, so a
   *  filter change does not blank the table it is filtering (design.md §5). */
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  reload: () => void;
  /** Lets a mutation's response replace the resource without a round trip —
   *  every quotation mutation already returns the whole recomputed object. */
  set: (value: T) => void;
}

export function useApi<T>(path: string | null, deps: unknown[] = []): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // Guards against a slow earlier request landing after a faster later one and
  // overwriting it — the classic filter-change race.
  const latest = useRef(0);
  const hasData = useRef(false);

  useEffect(() => {
    if (path === null) {
      setLoading(false);
      return;
    }
    const ticket = ++latest.current;
    if (hasData.current) setRefreshing(true);
    else setLoading(true);

    api
      .get<T>(path)
      .then((result) => {
        if (ticket !== latest.current) return;
        setData(result);
        hasData.current = true;
        setError(null);
      })
      .catch((err: unknown) => {
        if (ticket !== latest.current) return;
        setError(err instanceof ApiRequestError ? err.message : "Something went wrong.");
      })
      .finally(() => {
        if (ticket !== latest.current) return;
        setLoading(false);
        setRefreshing(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, nonce, ...deps]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const set = useCallback((value: T) => {
    setData(value);
    hasData.current = true;
  }, []);

  return { data, loading, refreshing, error, reload, set };
}

/**
 * Debounce for screen 4's discount field.
 *
 * The wireframe requires the limit check to run "live, as soon as it is
 * entered, not only at submit time" — but a request per keystroke would send
 * four for "12.5". 300ms is long enough to coalesce typing and short enough
 * that the Status column still feels immediate.
 */
export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}
