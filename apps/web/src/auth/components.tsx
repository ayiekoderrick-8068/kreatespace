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

interface TextFieldProps extends ComponentPropsWithoutRef<"input"> {
  label: string;
  error?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, error, ...props },
  ref,
) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        ref={ref}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="mt-1 block w-full rounded-md border border-ink-muted/40 bg-white px-3 py-2 text-base focus:border-terracotta focus:outline-2 focus:outline-terracotta"
        {...props}
      />
      {error ? (
        <p id={errorId} className="mt-1 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
});

export function PrimaryButton({ children, ...props }: ComponentPropsWithoutRef<"button">) {
  return (
    <button
      className="w-full rounded-md bg-terracotta px-4 py-2.5 font-medium text-white hover:bg-terracotta-dark focus:outline-2 focus:outline-offset-2 focus:outline-terracotta disabled:cursor-not-allowed disabled:opacity-60"
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
  kind: "error" | "success";
  children: ReactNode;
}) {
  return (
    <p
      role={kind === "error" ? "alert" : "status"}
      className={
        kind === "error"
          ? "rounded-md bg-red-50 px-3 py-2 text-sm text-red-800"
          : "rounded-md bg-green-50 px-3 py-2 text-sm text-green-900"
      }
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
