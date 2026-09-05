import { useState } from "react";
import type { FormEvent } from "react";
import { useAuth } from "../lib/auth";
import { ApiRequestError } from "../lib/api";
import { Button, Field, TextInput } from "@ui/index";

type Mode = "login" | "signup";

/**
 * Screen 1 — Login / Signup.
 *
 * Field errors come from the server validator's `fields` map, so every invalid
 * field is marked at once (TRD.md §6). Client-side checks here are for
 * responsiveness only; the server is the authority and re-validates everything.
 */
export function Login() {
  const { login, signup } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFields({});
    setFormError(null);

    const local: Record<string, string> = {};
    if (!email.trim()) local.email = "Enter your email address";
    else if (!email.includes("@")) local.email = "That does not look like an email address";
    if (!password) local.password = "Enter your password";
    else if (mode === "signup" && password.length < 8)
      local.password = "Use at least 8 characters";
    if (mode === "signup" && !fullName.trim()) local.full_name = "Enter your name";

    if (Object.keys(local).length > 0) {
      setFields(local);
      return;
    }

    setBusy(true);
    try {
      if (mode === "login") await login({ email, password });
      else await signup({ email, password, full_name: fullName });
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setFields(err.fields);
        // A 401 here means bad credentials. Deliberately not "no such user" —
        // that would confirm which emails have accounts.
        setFormError(
          err.code === "UNAUTHENTICATED"
            ? "Email or password is incorrect."
            : Object.keys(err.fields).length > 0
              ? null
              : err.message,
        );
      } else {
        setFormError("Something went wrong. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-6">
      <div className="w-full" style={{ maxWidth: "400px" }}>
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-text">DealFlow360</h1>
          <p className="mt-1 text-sm text-text-muted">
            Sales operations for teams that price with discipline
          </p>
        </div>

        <div className="rounded-md border border-border bg-surface p-6">
          {/* Mode toggle */}
          <div className="mb-6 flex gap-1 rounded-sm bg-bg p-1">
            {(["login", "signup"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setFields({});
                  setFormError(null);
                }}
                className={`flex-1 rounded-sm px-3 py-2 text-sm font-medium ${
                  mode === m ? "bg-surface text-text shadow-overlay" : "text-text-muted"
                }`}
              >
                {m === "login" ? "Log In" : "Sign Up"}
              </button>
            ))}
          </div>

          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            {mode === "signup" ? (
              <Field label="Full name" htmlFor="full_name" error={fields.full_name} required>
                <TextInput
                  id="full_name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  invalid={Boolean(fields.full_name)}
                  autoComplete="name"
                />
              </Field>
            ) : null}

            <Field label="Email" htmlFor="email" error={fields.email} required>
              <TextInput
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                invalid={Boolean(fields.email)}
                autoComplete="email"
              />
            </Field>

            <Field
              label="Password"
              htmlFor="password"
              error={fields.password}
              hint={mode === "signup" ? "At least 8 characters" : undefined}
              required
            >
              <TextInput
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                invalid={Boolean(fields.password)}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
            </Field>

            {formError ? (
              <div className="rounded-sm border border-danger bg-danger-subtle px-3 py-2 text-sm text-danger">
                {formError}
              </div>
            ) : null}

            <Button type="submit" variant="primary" loading={busy} className="w-full">
              {mode === "login" ? "Log In" : "Create Account"}
            </Button>
          </form>
        </div>

        <p className="mt-4 text-center text-xs text-text-muted">
          Customers do not sign in here — they open the quotation link their
          account manager sends them.
        </p>
      </div>
    </div>
  );
}
