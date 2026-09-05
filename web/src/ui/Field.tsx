import type { ReactNode, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

/**
 * Exists so label, hint and error presentation cannot diverge across 22
 * screens. `error` is fed straight from the validator's `fields` map, so the
 * UI marks every bad field at once instead of one per round trip (TRD.md §6).
 */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-xs font-medium text-text">
        {label}
        {required ? <span className="text-danger"> *</span> : null}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="text-xs text-text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

const CONTROL =
  "w-full rounded-sm border bg-surface px-3 py-2 text-sm text-text " +
  "placeholder:text-text-muted disabled:bg-bg disabled:text-text-muted";

export function TextInput({
  invalid,
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      {...props}
      aria-invalid={invalid || undefined}
      className={`${CONTROL} ${invalid ? "border-danger" : "border-border"} ${className}`}
    />
  );
}

export function TextArea({
  invalid,
  className = "",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      {...props}
      aria-invalid={invalid || undefined}
      className={`${CONTROL} ${invalid ? "border-danger" : "border-border"} ${className}`}
    />
  );
}

export function Select({
  invalid,
  className = "",
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select
      {...props}
      aria-invalid={invalid || undefined}
      className={`${CONTROL} ${invalid ? "border-danger" : "border-border"} ${className}`}
    >
      {children}
    </select>
  );
}
