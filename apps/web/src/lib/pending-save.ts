const KEY = "kreatespace.pendingSave";

export interface PendingSave {
  creationId: string;
  title: string;
}

// Remembers a creation someone tried to save before logging in, so the save can finish
// afterwards. Session storage keeps it to this tab; every access is guarded because storage
// can be unavailable (private windows, blocked cookies).
export function rememberPendingSave(save: PendingSave): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    /* ignore */
  }
}

export function recallPendingSave(): PendingSave | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PendingSave>;
    return typeof value.creationId === "string" && typeof value.title === "string"
      ? { creationId: value.creationId, title: value.title }
      : null;
  } catch {
    return null;
  }
}

export function forgetPendingSave(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
