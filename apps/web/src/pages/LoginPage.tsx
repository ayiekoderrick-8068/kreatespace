import { zodResolver } from "@hookform/resolvers/zod";
import { loginSchema, type LoginInput } from "@kreatespace/shared";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useLocation, useNavigate } from "react-router";
import { isGoogleAuthEnabled } from "../lib/supabase";
import { useAuth } from "../auth/AuthProvider";
import {
  AuthLayout,
  FormMessage,
  NotConfiguredNotice,
  PrimaryButton,
  TextField,
} from "../components/forms";

export function LoginPage() {
  const { configured, signIn, signInWithGoogle } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = (location.state as { from?: string } | null)?.from ?? "/";
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setFormError(null);
    const { error } = await signIn(email, password);
    if (error) {
      setFormError(error);
      return;
    }
    navigate(redirectTo, { replace: true });
  });

  async function onGoogle() {
    setFormError(null);
    const { error } = await signInWithGoogle();
    if (error) setFormError(error);
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Log in to save creations and manage your account."
      footer={
        <>
          New to KreateSpace?{" "}
          <Link to="/register" className="font-medium text-terracotta underline">
            Create an account
          </Link>
        </>
      }
    >
      {!configured ? <NotConfiguredNotice /> : null}
      <form onSubmit={onSubmit} noValidate className="mt-4 space-y-4">
        {formError ? <FormMessage kind="error">{formError}</FormMessage> : null}
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
          autoComplete="current-password"
          error={errors.password?.message}
          {...register("password")}
        />
        <div className="text-right text-sm">
          <Link to="/forgot-password" className="text-terracotta underline">
            Forgot password?
          </Link>
        </div>
        <PrimaryButton type="submit" disabled={isSubmitting || !configured}>
          {isSubmitting ? "Logging in…" : "Log in"}
        </PrimaryButton>
      </form>
      {isGoogleAuthEnabled ? (
        <button
          type="button"
          onClick={onGoogle}
          disabled={!configured}
          className="mt-3 w-full rounded-md border border-ink-muted/40 bg-white px-4 py-2.5 font-medium hover:bg-cream disabled:opacity-60"
        >
          Continue with Google
        </button>
      ) : null}
    </AuthLayout>
  );
}
