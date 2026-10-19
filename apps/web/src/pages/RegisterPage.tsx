import { zodResolver } from "@hookform/resolvers/zod";
import { registerSchema, type RegisterInput } from "@kreatespace/shared";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import {
  AuthLayout,
  FormMessage,
  NotConfiguredNotice,
  PrimaryButton,
  TextField,
} from "../components/forms";

export function RegisterPage() {
  const { configured, signUp } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const [verifyEmail, setVerifyEmail] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({ resolver: zodResolver(registerSchema) });

  const onSubmit = handleSubmit(async ({ fullName, email, password }) => {
    setFormError(null);
    const result = await signUp({ fullName, email, password });
    if (result.error) {
      setFormError(result.error);
      return;
    }
    if (result.needsEmailVerification) {
      setVerifyEmail(email);
      return;
    }
    navigate("/", { replace: true });
  });

  if (verifyEmail) {
    return (
      <AuthLayout title="Check your email">
        <FormMessage kind="success">
          We’ve sent a verification link to <strong>{verifyEmail}</strong>. Open it to activate your
          account, then log in. Can’t find it? Check your spam folder. If you already have an
          account with this email, just log in or reset your password.
        </FormMessage>
        <Link
          to="/login"
          className="mt-4 inline-block font-medium text-terracotta underline focus:outline-2"
        >
          Go to log in
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Save the creations you love and contact sellers with ease."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-terracotta underline">
            Log in
          </Link>
        </>
      }
    >
      {!configured ? <NotConfiguredNotice /> : null}
      <form onSubmit={onSubmit} noValidate className="mt-4 space-y-4">
        {formError ? <FormMessage kind="error">{formError}</FormMessage> : null}
        <TextField
          label="Full name"
          autoComplete="name"
          error={errors.fullName?.message}
          {...register("fullName")}
        />
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          {...register("email")}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          error={errors.password?.message}
          {...register("password")}
        />
        <TextField
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          {...register("confirmPassword")}
        />
        <PrimaryButton type="submit" disabled={isSubmitting || !configured}>
          {isSubmitting ? "Creating account…" : "Create account"}
        </PrimaryButton>
      </form>
    </AuthLayout>
  );
}
