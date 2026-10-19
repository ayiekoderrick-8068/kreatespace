import { zodResolver } from "@hookform/resolvers/zod";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@kreatespace/shared";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import {
  AuthLayout,
  FormMessage,
  NotConfiguredNotice,
  PrimaryButton,
  TextField,
} from "../auth/components";

export function ForgotPasswordPage() {
  const { configured, requestPasswordReset } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({ resolver: zodResolver(forgotPasswordSchema) });

  const onSubmit = handleSubmit(async ({ email }) => {
    setFormError(null);
    const { error } = await requestPasswordReset(email);
    if (error) {
      setFormError(error);
      return;
    }
    setSent(true);
  });

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="Enter your email and we’ll send you a link to choose a new password."
      footer={
        <Link to="/login" className="font-medium text-terracotta underline">
          Back to log in
        </Link>
      }
    >
      {!configured ? <NotConfiguredNotice /> : null}
      {sent ? (
        <FormMessage kind="success">
          If an account exists for that email, a reset link is on its way.
        </FormMessage>
      ) : (
        <form onSubmit={onSubmit} noValidate className="mt-4 space-y-4">
          {formError ? <FormMessage kind="error">{formError}</FormMessage> : null}
          <TextField
            label="Email"
            type="email"
            autoComplete="email"
            error={errors.email?.message}
            {...register("email")}
          />
          <PrimaryButton type="submit" disabled={isSubmitting || !configured}>
            {isSubmitting ? "Sending…" : "Send reset link"}
          </PrimaryButton>
        </form>
      )}
    </AuthLayout>
  );
}
