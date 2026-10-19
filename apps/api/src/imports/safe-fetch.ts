import { lookup as dnsLookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { hostMatchesDomain, isInternalHostname, isPublicAddress } from "./net-guard.js";

/** Why a fetch was refused or failed. Codes are safe to show; details stay in server logs. */
export type FetchFailure =
  | "INVALID_URL"
  | "NOT_AUTHORIZED"
  | "BLOCKED_ADDRESS"
  | "UNSUPPORTED_PORT"
  | "TOO_MANY_REDIRECTS"
  | "TIMEOUT"
  | "TOO_LARGE"
  | "UNSUPPORTED_TYPE"
  | "HTTP_ERROR"
  | "UNREACHABLE";

export class FetchRefusedError extends Error {
  constructor(
    readonly code: FetchFailure,
    message: string,
    /** Extra detail for server logs only; never sent to a client. */
    readonly detail?: string,
  ) {
    super(message);
    this.name = "FetchRefusedError";
  }
}

export interface FetchedResource {
  url: string;
  status: number;
  contentType: string;
  body: Buffer;
}

export interface FetchOptions {
  /** Every URL fetched, including each redirect hop, must be on this domain or a subdomain. */
  domain: string;
  /** Content types accepted for the response body (compared without parameters). */
  allowedTypes: readonly string[];
  maxBytes: number;
}

export interface SafeFetcher {
  fetch(url: string, options: FetchOptions): Promise<FetchedResource>;
}

export interface SafeFetcherPolicy {
  /** Whole-request time budget, redirects included. */
  timeoutMs?: number;
  maxRedirects?: number;
  userAgent?: string;
  /**
   * The checks below exist so tests can reach a local server. Production code never passes them,
   * and the defaults allow only public addresses on ports 80 and 443.
   */
  resolve?: (hostname: string) => Promise<{ address: string; family: 4 | 6 }[]>;
  allowAddress?: (address: string) => boolean;
  allowPort?: (port: number, protocol: "http:" | "https:") => boolean;
}

const defaultResolve = (hostname: string) =>
  new Promise<{ address: string; family: 4 | 6 }[]>((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) reject(error);
      else resolve(addresses.map((a) => ({ address: a.address, family: a.family as 4 | 6 })));
    });
  });

const defaultAllowPort = (port: number, protocol: "http:" | "https:") =>
  protocol === "https:" ? port === 443 : port === 80;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Fetches pages and images from one authorised website without ever reaching internal systems:
 *
 * - only http and https, no credentials in the URL, only the standard ports;
 * - the host (and every redirect target) must be the authorised domain or a subdomain;
 * - every resolved address must be public. The check runs inside the socket's own DNS lookup, and
 *   the connection uses exactly the address that was checked, so DNS cannot change the answer
 *   between the check and the connection (DNS rebinding);
 * - redirects are followed by hand, a few at most, re-checking each hop and refusing downgrades;
 * - a total time limit, a response size limit, and an allow-list of content types.
 */
export function createSafeFetcher(policy: SafeFetcherPolicy = {}): SafeFetcher {
  const timeoutMs = policy.timeoutMs ?? 10_000;
  const maxRedirects = policy.maxRedirects ?? 3;
  const userAgent = policy.userAgent ?? "KreateSpaceImporter/1.0 (+https://kreatespace.co.ke)";
  const resolve = policy.resolve ?? defaultResolve;
  const allowAddress = policy.allowAddress ?? isPublicAddress;
  const allowPort = policy.allowPort ?? defaultAllowPort;

  /** Resolves, validates, and hands the socket the one address that passed. */
  const guardedLookup: LookupFunction = (hostname, options, callback) => {
    resolve(hostname).then(
      (addresses) => {
        const usable = addresses.filter((a) => allowAddress(a.address));
        // Refuse outright if any answer is internal: a mixed answer is a classic rebinding setup.
        if (usable.length === 0 || usable.length !== addresses.length) {
          const error = Object.assign(new Error("blocked address"), { code: "EBLOCKED" });
          callback(error as NodeJS.ErrnoException, "", 0);
          return;
        }
        if ((options as { all?: boolean }).all) {
          (callback as unknown as (e: null, a: { address: string; family: number }[]) => void)(
            null,
            usable,
          );
        } else {
          callback(null, usable[0]!.address, usable[0]!.family);
        }
      },
      (error: NodeJS.ErrnoException) => callback(error, "", 0),
    );
  };

  function checkUrl(raw: string, domain: string): URL {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new FetchRefusedError("INVALID_URL", "That address isn’t valid.");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new FetchRefusedError("INVALID_URL", "Only web addresses can be imported.");
    }
    if (url.username || url.password) {
      throw new FetchRefusedError("INVALID_URL", "Addresses with a login aren’t allowed.");
    }
    const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
    if (!allowPort(port, url.protocol)) {
      throw new FetchRefusedError("UNSUPPORTED_PORT", "That address uses an unsupported port.");
    }
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (!hostMatchesDomain(host, domain)) {
      throw new FetchRefusedError(
        "NOT_AUTHORIZED",
        "That address is outside the website you’re authorised to import from.",
        `${host} is not under ${domain}`,
      );
    }
    // A literal IP never goes through DNS, so it is checked here. Internal names are refused too.
    if (isIP(host) !== 0) {
      if (!allowAddress(host)) {
        throw new FetchRefusedError("BLOCKED_ADDRESS", "That address can’t be imported.", host);
      }
    } else if (isInternalHostname(host)) {
      throw new FetchRefusedError("BLOCKED_ADDRESS", "That address can’t be imported.", host);
    }
    return url;
  }

  function once(
    url: URL,
    options: FetchOptions,
    signal: AbortSignal,
  ): Promise<{ response: http.IncomingMessage; body: Buffer }> {
    return new Promise((resolveOnce, reject) => {
      const client = url.protocol === "https:" ? https : http;
      const request = client.request(
        url,
        {
          method: "GET",
          lookup: guardedLookup,
          signal,
          // No connection reuse: each request is validated from scratch.
          agent: false,
          headers: {
            "User-Agent": userAgent,
            Accept: options.allowedTypes.join(", "),
            // Never ask for compression, so a small download can't expand into a huge one.
            "Accept-Encoding": "identity",
          },
        },
        (response) => {
          const status = response.statusCode ?? 0;
          if (REDIRECT_STATUSES.has(status)) {
            response.resume();
            resolveOnce({ response, body: Buffer.alloc(0) });
            return;
          }
          const declared = Number(response.headers["content-length"]);
          if (Number.isFinite(declared) && declared > options.maxBytes) {
            response.destroy();
            reject(new FetchRefusedError("TOO_LARGE", "That file is too large to import."));
            return;
          }
          const type = String(response.headers["content-type"] ?? "")
            .split(";")[0]!
            .trim()
            .toLowerCase();
          if (status >= 200 && status < 300 && !options.allowedTypes.includes(type)) {
            response.destroy();
            reject(new FetchRefusedError("UNSUPPORTED_TYPE", "That file type can’t be imported."));
            return;
          }
          const chunks: Buffer[] = [];
          let received = 0;
          response.on("data", (chunk: Buffer) => {
            received += chunk.length;
            if (received > options.maxBytes) {
              response.destroy();
              reject(new FetchRefusedError("TOO_LARGE", "That file is too large to import."));
              return;
            }
            chunks.push(chunk);
          });
          response.on("end", () => resolveOnce({ response, body: Buffer.concat(chunks) }));
          response.on("error", reject);
        },
      );
      request.on("error", reject);
      request.end();
    });
  }

  return {
    async fetch(raw, options) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let url = checkUrl(raw, options.domain);
        for (let hop = 0; ; hop++) {
          let result: Awaited<ReturnType<typeof once>>;
          try {
            result = await once(url, options, controller.signal);
          } catch (error) {
            if (error instanceof FetchRefusedError) throw error;
            if (controller.signal.aborted) {
              throw new FetchRefusedError("TIMEOUT", "The website took too long to respond.");
            }
            const code = (error as NodeJS.ErrnoException)?.code;
            if (code === "EBLOCKED") {
              throw new FetchRefusedError(
                "BLOCKED_ADDRESS",
                "That address can’t be imported.",
                url.hostname,
              );
            }
            throw new FetchRefusedError(
              "UNREACHABLE",
              "The website couldn’t be reached.",
              String(code ?? (error as Error)?.message),
            );
          }

          const { response, body } = result;
          const status = response.statusCode ?? 0;
          if (REDIRECT_STATUSES.has(status)) {
            const location = response.headers.location;
            if (!location)
              throw new FetchRefusedError("HTTP_ERROR", "The website sent a bad redirect.");
            if (hop >= maxRedirects) {
              throw new FetchRefusedError(
                "TOO_MANY_REDIRECTS",
                "The website redirected too many times.",
              );
            }
            const next = checkUrl(new URL(location, url).toString(), options.domain);
            if (url.protocol === "https:" && next.protocol === "http:") {
              throw new FetchRefusedError(
                "NOT_AUTHORIZED",
                "The website tried to move to an insecure address.",
              );
            }
            url = next;
            continue;
          }
          if (status < 200 || status >= 300) {
            throw new FetchRefusedError(
              "HTTP_ERROR",
              `The website answered with status ${status}.`,
            );
          }
          const contentType = String(response.headers["content-type"] ?? "")
            .split(";")[0]!
            .trim()
            .toLowerCase();
          return { url: url.toString(), status, contentType, body };
        }
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
