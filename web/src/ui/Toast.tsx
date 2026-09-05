import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Tone } from "./Badge";

interface Toast {
  id: number;
  tone: Tone;
  message: string;
  onRetry?: () => void;
}

interface ToastApi {
  /** Request-level failures surface here with a plain-language cause. */
  show: (message: string, tone?: Tone, onRetry?: () => void) => void;
}

const Ctx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(Ctx);
  if (!api) throw new Error("useToast must be used inside <ToastProvider>");
  return api;
}

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const show = useCallback<ToastApi["show"]>(
    (message, tone = "danger", onRetry) => {
      const id = nextId++;
      setToasts((t) => [...t, { id, tone, message, onRetry }]);
      // Errors with a retry stay until dismissed; everything else self-clears.
      if (!onRetry) setTimeout(() => dismiss(id), 5000);
    },
    [dismiss],
  );

  const api = useMemo(() => ({ show }), [show]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="fixed bottom-6 right-6 z-50 flex w-80 flex-col gap-2"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`rounded-md border bg-surface p-3 shadow-overlay ${
              t.tone === "danger" ? "border-danger" : "border-border"
            }`}
          >
            <p className="text-sm text-text">{t.message}</p>
            <div className="mt-2 flex justify-end gap-2">
              {t.onRetry ? (
                <button
                  onClick={() => {
                    dismiss(t.id);
                    t.onRetry?.();
                  }}
                  className="text-xs font-medium text-brand hover:underline"
                >
                  Retry
                </button>
              ) : null}
              <button
                onClick={() => dismiss(t.id)}
                className="text-xs font-medium text-text-muted hover:text-text"
              >
                Dismiss
              </button>
            </div>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
