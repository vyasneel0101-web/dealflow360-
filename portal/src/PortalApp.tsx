import { useState } from "react";
import type { ReactNode } from "react";

/**
 * The customer-facing application — a SEPARATE bundle, not a route inside the
 * internal app.
 *
 * PS §7: "The customer facing negotiation screen must be a real, separate,
 * restricted view, not just another internal screen with a different label."
 * This file is the build-level half of that guarantee — internal code is never
 * shipped to a customer's browser. The auth-level half is the two session
 * realms (DB_SCHEMA.md §2).
 *
 * Nothing here imports from web/src. That is deliberate and worth preserving:
 * the moment the portal reuses an internal screen, the separation is cosmetic.
 *
 * Slice 1 ships this shell. Slice 7 fills in negotiation.
 */

const NAV = [
  { label: "My Quotation", to: "/" },
  { label: "Messages", to: "/messages" },
  { label: "Profile", to: "/profile" },
] as const;

export function PortalApp() {
  const [active, setActive] = useState<string>("/");

  return (
    <div className="min-h-screen bg-bg">
      {/* Calmer than the internal header: fewer controls, more air. The portal
          should not look like the same product with a filter applied. */}
      <header className="border-b border-border bg-surface">
        <div className="mx-auto max-w-portal px-6 py-4">
          <div className="text-base font-semibold text-text">DealFlow360</div>
          <nav className="mt-3 flex gap-1">
            {NAV.map((item) => (
              <button
                key={item.to}
                onClick={() => setActive(item.to)}
                className={`rounded-sm px-3 py-2 text-sm ${
                  active === item.to
                    ? "font-semibold text-text shadow-[inset_0_-2px_0_0_#2563EB]"
                    : "text-text-muted hover:text-text"
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-portal p-6">
        <Panel>
          <h1 className="text-xl font-semibold text-text">Your quotation</h1>
          <p className="mt-2 text-sm text-text-muted">
            Review the quotation your account manager sent you, ask questions on
            any line, and propose changes — without a single email.
          </p>
          <p className="mt-6 text-sm text-text-muted">
            This view arrives in Slice 7.
          </p>
        </Panel>
      </main>
    </div>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return <section className="rounded-md border border-border bg-surface p-6">{children}</section>;
}
