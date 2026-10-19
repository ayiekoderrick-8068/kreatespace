import { zodResolver } from "@hookform/resolvers/zod";
import { resetPasswordSchema, type ResetPasswordInput } from "@kreatespace/shared";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import { AuthLayout, FormMessage, PrimaryButton, TextField } from "../components/forms";

export function ResetPasswordPage() {
  const { loading, recovering, session, updatePassword } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({ resolver: zodResolver(resetPasswordSchema) });

  const onSubmit = handleSubmit(async ({ password }) => {
    setFormError(null);
    const { error } = await updatePassword(password);
    if (error) {
      setFormError(error);
      return;
    }
    navigate("/", { replace: true });
  });

  if (loading) {
    return (
      <AuthLayout title="Choose a new password">
        <p role="status" className="text-ink-muted">
          Loading…
        </p>
      </AuthLayout>
    );
  }

  if (!recovering && !session) {
    return (
      <AuthLayout title="Link expired">
        <FormMessage kind="error">
          This password reset link is invalid or has expired. Request a new one to continue.
        </FormMessage>
        <Link
          to="/forgot-password"
          className="mt-4 inline-block font-medium text-terracotta underline"
        >
          Request a new link
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {formError ? <FormMessage kind="error">{formError}</FormMessage> : null}
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          error={errors.password?.message}
          {...register("password")}
        />
        <TextField
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          {...register("confirmPassword")}
        />
        <PrimaryButton type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Update password"}
        </PrimaryButton>
      </form>
    </AuthLayout>
  );
}
