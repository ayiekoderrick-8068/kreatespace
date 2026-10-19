import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { forwardRef, useId } from "react";

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-10">
      <div className="rounded-xl border border-cream-dark bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-ink-muted">{subtitle}</p> : null}
        <div className="mt-6">{children}</div>
      </div>
      {footer ? <p className="mt-4 text-center text-sm text-ink-muted">{footer}</p> : null}
    </main>
  );
}

const inputClasses =
  "mt-1 block w-full rounded-md border border-ink-muted/40 bg-white px-3 py-2 text-base focus:border-terracotta focus:outline-2 focus:outline-terracotta";

interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  /** Marks the field as optional in its label; required fields are marked with an asterisk. */
  optional?: boolean;
  required?: boolean;
}

function FieldShell({
  id,
  label,
  error,
  hint,
  optional,
  required,
  children,
}: FieldProps & { id: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
        {optional ? <span className="ml-1 font-normal text-ink-muted">(optional)</span> : null}
        {required ? (
          <span aria-hidden="true" className="ml-0.5 text-terracotta">
            *
          </span>
        ) : null}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${id}-hint`} className="mt-1 text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const describedBy = (id: string, error?: string, hint?: string) =>
  error ? `${id}-error` : hint ? `${id}-hint` : undefined;

type TextFieldProps = FieldProps & ComponentPropsWithoutRef<"input">;

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, error, hint, optional, required, ...props },
  ref,
) {
  const id = useId();
  return (
    <FieldShell {...{ id, label, error, hint, optional, required }}>
      <input
        id={id}
        ref={ref}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={inputClasses}
        {...props}
      />
    </FieldShell>
  );
});

type TextAreaFieldProps = FieldProps & ComponentPropsWithoutRef<"textarea">;

export const TextAreaField = forwardRef<HTMLTextAreaElement, TextAreaFieldProps>(
  function TextAreaField({ label, error, hint, optional, required, ...props }, ref) {
    const id = useId();
    return (
      <FieldShell {...{ id, label, error, hint, optional, required }}>
        <textarea
          id={id}
          ref={ref}
          rows={5}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, error, hint)}
          className={inputClasses}
          {...props}
        />
      </FieldShell>
    );
  },
);

type SelectFieldProps = FieldProps &
  ComponentPropsWithoutRef<"select"> & {
    placeholder: string;
    options: { value: string; label: string }[];
  };

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, error, hint, optional, required, placeholder, options, ...props },
  ref,
) {
  const id = useId();
  return (
    <FieldShell {...{ id, label, error, hint, optional, required }}>
      <select
        id={id}
        ref={ref}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={inputClasses}
        {...props}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
});

export function CheckboxField({
  label,
  error,
  ...props
}: { label: ReactNode; error?: string } & Omit<ComponentPropsWithoutRef<"input">, "type">) {
  const id = useId();
  return (
    <div>
      <div className="flex items-start gap-3">
        <input
          id={id}
          type="checkbox"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="mt-1 h-5 w-5 shrink-0 accent-terracotta"
          {...props}
        />
        <label htmlFor={id} className="text-sm">
          {label}
        </label>
      </div>
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function PrimaryButton({
  children,
  className = "",
  ...props
}: ComponentPropsWithoutRef<"button">) {
  return (
    <button
      className={`rounded-md bg-terracotta px-4 py-2.5 font-medium text-white hover:bg-terracotta-dark focus:outline-2 focus:outline-offset-2 focus:outline-terracotta disabled:cursor-not-allowed disabled:opacity-60 ${className || "w-full"}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  className = "",
  ...props
}: ComponentPropsWithoutRef<"button">) {
  return (
    <button
      className={`rounded-md border border-ink-muted/40 bg-white px-4 py-2.5 font-medium hover:bg-cream focus:outline-2 focus:outline-offset-2 focus:outline-terracotta disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function FormMessage({
  kind,
  children,
}: {
  kind: "error" | "success" | "info";
  children: ReactNode;
}) {
  const styles = {
    error: "bg-red-50 text-red-800",
    success: "bg-green-50 text-green-900",
    info: "bg-cream-dark text-ink",
  } as const;
  return (
    <p
      role={kind === "error" ? "alert" : "status"}
      className={`rounded-md px-3 py-2 text-sm ${styles[kind]}`}
    >
      {children}
    </p>
  );
}

export function NotConfiguredNotice() {
  return (
    <FormMessage kind="error">
      Sign-in is not available right now because authentication is not configured.
    </FormMessage>
  );
}
