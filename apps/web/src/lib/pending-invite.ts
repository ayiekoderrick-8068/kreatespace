const KEY = "kreatespace.pendingInvite";

// Remembers an invitation link across sign-up and email verification. Storage can be
// unavailable (private windows, blocked cookies), so every access is guarded.
export function rememberInvite(token: string): void {
  try {
    window.localStorage.setItem(KEY, token);
  } catch {
    /* ignore */
  }
}

export function recallInvite(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function forgetInvite(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
