import { useState } from "react";
import type { ReactNode } from "react";
import { Link, useRouter } from "../lib/router";
import { useAuth } from "../lib/auth";
import { Button } from "@ui/index";

/**
 * Nine-item nav, per the wireframe (WIREFRAME_NOTES.md §3). The PS text lists
 * only Quotations and Pipeline; the wireframe's nav is a superset and every PS
 * destination is reachable from it, so we adopt the wireframe.
 *
 * The three PS workspace actions (B1.2-B1.4) sit in a right-aligned utility
 * cluster rather than in primary nav — they are actions, not modules.
 */
const NAV = [
  { label: "Dashboard", to: "/" },
  { label: "Quotations", to: "/quotations" },
  { label: "Approvals", to: "/approvals" },
  { label: "Fulfillment", to: "/fulfillment" },
  { label: "Subscriptions", to: "/subscriptions" },
  { label: "Invoices", to: "/invoices" },
  { label: "Deal Health", to: "/deal-health" },
  { label: "Reports", to: "/reports" },
  { label: "Product", to: "/products" },
] as const;

export function AppShell({
  children,
  onReloadData,
}: {
  children: ReactNode;
  onReloadData?: () => void;
}) {
  const { path, navigate } = useRouter();
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const isActive = (to: string) => (to === "/" ? path === "/" : path.startsWith(to));

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-page items-center gap-6 px-6 py-3">
          <Link to="/" className="text-base font-semibold text-text">
            DealFlow360
          </Link>

          {/* Primary nav — the active tab is the wireframe's "white highlighted
              tab shows which module you are in". */}
          <nav className="hidden flex-1 items-center gap-1 lg:flex">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={`rounded-sm px-3 py-2 text-sm ${
                  isActive(item.to)
                    ? "font-semibold text-text shadow-[inset_0_-2px_0_0_#2563EB]"
                    : "text-text-muted hover:text-text"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          {/* Utility cluster — visually secondary, per design.md §3. */}
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" onClick={onReloadData} title="Refresh pricing, stock and approval data">
              Reload Data
            </Button>
            <Button variant="ghost" onClick={() => navigate("/products")}>
              Go to Back-end
            </Button>
            <Button variant="ghost" onClick={() => void logout()}>
              Close Workspace
            </Button>
            <span className="hidden text-xs text-text-muted sm:inline">
              {user?.full_name} · {user?.role}
            </span>
          </div>

          <button
            className="lg:hidden"
            aria-label="Menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            ☰
          </button>
        </div>

        {/* Below 1024px the nav becomes a drawer (design.md §7). */}
        {menuOpen ? (
          <nav className="border-t border-border lg:hidden">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={`block border-b border-border px-6 py-3 text-sm ${
                  isActive(item.to) ? "font-semibold text-text" : "text-text-muted"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        ) : null}
      </header>

      <main>{children}</main>
    </div>
  );
}
