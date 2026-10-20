import { describeError } from "./log.js";

/** What is sent when the server hits an unexpected error. Never request bodies, headers or queries. */
export interface ErrorReport {
  service: string;
  time: string;
  /** Where it happened, such as "POST /api/me/deletion" or "maintenance". Never holds values. */
  context: string;
  error: ReturnType<typeof describeError>;
}

export type ErrorReporter = (report: ErrorReport) => Promise<void> | void;

let reporter: ErrorReporter | null = null;

/** Chooses where unexpected errors are sent besides the log. Pass null to switch it off. */
export function setErrorReporter(next: ErrorReporter | null): void {
  reporter = next;
}

export function hasErrorReporter(): boolean {
  return reporter !== null;
}

/**
 * Tells whoever is on call that something unexpected broke. It never throws and never slows a
 * request down: the returned promise settles when the report has been sent (or has failed), and
 * callers on the request path simply ignore it.
 */
export function reportError(error: unknown, context: string, service = "api"): Promise<void> {
  const current = reporter;
  if (!current) return Promise.resolve();
  try {
    const sent = current({
      service,
      time: new Date().toISOString(),
      context,
      error: describeError(error),
    });
    return Promise.resolve(sent).catch(() => undefined);
  } catch {
    return Promise.resolve();
  }
}

export interface WebhookOptions {
  /** For tests. */
  fetch?: typeof fetch;
  /** The same error is reported at most once per this long. */
  repeatMs?: number;
  /** At most this many reports go out per minute, whatever the errors are. */
  perMinute?: number;
  timeoutMs?: number;
  now?: () => number;
}

/**
 * Sends reports to a web address as JSON, in the shape chat and alerting tools accept (`text` holds
 * a one-line summary). A failing or slow address is ignored: reporting must never make an outage
 * worse. Repeats of the same error and floods are held back so one fault sends one alert.
 */
export function createWebhookReporter(url: string, options: WebhookOptions = {}): ErrorReporter {
  const send = options.fetch ?? fetch;
  const repeatMs = options.repeatMs ?? 10 * 60_000;
  const perMinute = options.perMinute ?? 10;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const now = options.now ?? Date.now;
  const lastSent = new Map<string, number>();
  const recent: number[] = [];

  return async (report) => {
    const at = now();
    const key = `${report.service}|${report.context}|${report.error.name}|${report.error.message}`;
    const previous = lastSent.get(key);
    if (previous !== undefined && at - previous < repeatMs) return;
    while (recent.length > 0 && at - recent[0]! >= 60_000) recent.shift();
    if (recent.length >= perMinute) return;
    lastSent.set(key, at);
    recent.push(at);
    // Keep the memory of past errors small.
    if (lastSent.size > 200) {
      for (const [oldKey, when] of lastSent) if (at - when >= repeatMs) lastSent.delete(oldKey);
    }

    const summary = `KreateSpace ${report.service} error in ${report.context}: ${report.error.name}${
      report.error.code ? ` (${report.error.code})` : ""
    }${report.error.message ? ` — ${report.error.message}` : ""}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      await send(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: summary, ...report }),
        signal: controller.signal,
      });
    } catch {
      // Nothing more can be done; the error is already in the log.
    } finally {
      clearTimeout(timer);
    }
  };
}
