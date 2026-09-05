import { useState } from "react";
import { AppShell } from "./app/AppShell";
import { Login } from "./screens/Login";
import { Quotations } from "./screens/Quotations";
import { QuotationBuilder } from "./screens/QuotationBuilder";
import { useAuth } from "./lib/auth";
import { matchPath, useRouter } from "./lib/router";
import { EmptyState, Button } from "@ui/index";

/**
 * Route table. Screens land here as slices complete — Slice 1 ships the shell,
 * auth and Login; every later slice replaces one Placeholder with a real screen.
 *
 * Keeping the table explicit means both developers can see at a glance what is
 * built and what is still stubbed.
 */
const ROUTES: { pattern: string; title: string; slice: string }[] = [
  { pattern: "/", title: "Sales Dashboard", slice: "Slice 5" },
  { pattern: "/quotations", title: "Quotations", slice: "Slice 3" },
  { pattern: "/quotations/:id", title: "Quotation Detail", slice: "Slice 3" },
  { pattern: "/approvals", title: "Approvals", slice: "Slice 4" },
  { pattern: "/approvals/:id", title: "Approval Detail", slice: "Slice 4" },
  { pattern: "/fulfillment", title: "Fulfillment and Stock", slice: "Slice 5" },
  { pattern: "/fulfillment/:id", title: "Fulfillment Detail", slice: "Slice 5" },
  { pattern: "/subscriptions", title: "Subscriptions", slice: "Slice 6" },
  { pattern: "/subscriptions/:id", title: "Billing Detail", slice: "Slice 6" },
  { pattern: "/invoices", title: "Invoices", slice: "Slice 6" },
  { pattern: "/invoices/:id", title: "Invoice Detail", slice: "Slice 6" },
  { pattern: "/deal-health", title: "Deal Health", slice: "Slice 8" },
  { pattern: "/reports", title: "Reports", slice: "Slice 9" },
  { pattern: "/products", title: "Products", slice: "Slice 2" },
  { pattern: "/products/:id", title: "Product Detail", slice: "Slice 2" },
  { pattern: "/settings/discounts", title: "Discount Tiers and Approval Chain", slice: "Slice 2" },
];

export function App() {
  const { user, loading } = useAuth();
  const { path } = useRouter();
  const [reloadKey, setReloadKey] = useState(0);

  // Restoring a stored session — a full-page spinner is correct here and only
  // here, because there is genuinely nothing to render yet.
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <div className="skeleton h-4 w-32" />
      </div>
    );
  }

  if (!user) return <Login />;

  const route = ROUTES.find((r) => matchPath(r.pattern, path) !== null);

  return (
    <AppShell onReloadData={() => setReloadKey((k) => k + 1)}>
      {/* `reloadKey` remounts the subtree, which is what B1.2's Reload Data
          does: refetch everything from the server rather than trusting what is
          already on screen. */}
      <div key={reloadKey}>{renderRoute(path, route)}</div>
    </AppShell>
  );
}

/** Built screens first; anything still stubbed falls through to Placeholder. */
function renderRoute(
  path: string,
  route: { pattern: string; title: string; slice: string } | undefined,
) {
  const builder = matchPath("/quotations/:id", path);
  if (builder?.id) return <QuotationBuilder id={Number(builder.id)} />;
  if (matchPath("/quotations", path)) return <Quotations />;

  if (!route) return <NotFound path={path} />;
  return <Placeholder title={route.title} slice={route.slice} />;
}

/** Replaced by a real screen as each slice lands. */
function Placeholder({ title, slice }: { title: string; slice: string }) {
  return (
    <div className="mx-auto max-w-page p-6">
      <div className="rounded-md border border-border bg-surface">
        <EmptyState
          title={title}
          description={`This screen arrives in ${slice}. The shell, design tokens, component library and routing are in place — the screen itself is next.`}
        />
      </div>
    </div>
  );
}

function NotFound({ path }: { path: string }) {
  const { navigate } = useRouter();
  return (
    <div className="mx-auto max-w-page p-6">
      <div className="rounded-md border border-border bg-surface">
        <EmptyState
          title="Page not found"
          description={`Nothing lives at ${path}.`}
          action={
            <Button variant="primary" onClick={() => navigate("/")}>
              Back to Dashboard
            </Button>
          }
        />
      </div>
    </div>
  );
}
