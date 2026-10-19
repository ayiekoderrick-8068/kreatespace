interface AuthErrorLike {
  message?: string;
  status?: number;
  code?: string;
}

const GENERIC = "Something went wrong. Please try again.";

/**
 * Turns an error from the sign-in service into words that are safe to show. Only a short list of
 * known messages passes through; anything else (network details, server wording) becomes a
 * generic message so technical detail never reaches the page.
 */
export function authErrorMessage(error: AuthErrorLike | null | undefined): string | null {
  if (!error) return null;
  const text = error.message ?? "";

  if (error.status === 429 || /rate limit|too many/i.test(text)) {
    return "Too many attempts. Please wait a few minutes and try again.";
  }
  // Deliberately identical for a wrong password and an unknown email.
  if (/invalid login credentials/i.test(text)) return "Invalid login credentials";
  if (/email not confirmed/i.test(text)) {
    return "Please verify your email address first. Check your inbox for the link.";
  }
  if (
    /password should be|password is too|weak password|new password should be different/i.test(text)
  ) {
    return text;
  }
  if (/link.*(expired|invalid)|token.*(expired|invalid)|otp.*expired/i.test(text)) {
    return "That link has expired or is no longer valid. Please request a new one.";
  }
  return GENERIC;
}

/**
 * Whether a sign-up error just means the address already has an account. The page treats this
 * exactly like a new sign-up so nobody can use the form to find out who is registered.
 */
export function isAlreadyRegistered(error: AuthErrorLike | null | undefined): boolean {
  return Boolean(
    error &&
    (error.code === "user_already_exists" ||
      /already (been )?registered/i.test(error.message ?? "")),
  );
}
