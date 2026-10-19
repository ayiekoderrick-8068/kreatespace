import type { InquiryEventInput } from "@kreatespace/shared";
import { useEffect } from "react";
import { apiUrl } from "./api";

/**
 * Sends one anonymous analytics event. It names what was viewed or clicked and nothing about
 * the visitor, never waits for an answer, and can never break the page. A WhatsApp click means
 * the link was opened, not that a message was sent.
 */
export function trackEvent(event: InquiryEventInput): void {
  try {
    void fetch(apiUrl("/api/public/events"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
      // Lets the request finish even when the click opens another app or tab.
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* analytics must never get in the way */
  }
}

const SEEN_KEY = "kreatespace.viewed";

function alreadyCounted(key: string): boolean {
  try {
    const seen = new Set<string>(JSON.parse(window.sessionStorage.getItem(SEEN_KEY) ?? "[]"));
    if (seen.has(key)) return true;
    seen.add(key);
    window.sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-200)));
    return false;
  } catch {
    return false;
  }
}

/** Counts a page view once per browser session, however often the page re-renders. */
export function useTrackView(key: string | null, event: InquiryEventInput | null): void {
  useEffect(() => {
    if (!key || !event || alreadyCounted(key)) return;
    trackEvent(event);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key identifies the event
  }, [key]);
}
