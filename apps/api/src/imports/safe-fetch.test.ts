import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FetchRefusedError,
  createSafeFetcher,
  type FetchFailure,
  type FetchOptions,
  type SafeFetcherPolicy,
} from "./safe-fetch.js";

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

let server: http.Server;
let port: number;
let handler: Handler = (_req, res) => res.end("ok");
const hits: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits.push(`${req.headers.host}${req.url}`);
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

/** Resolves every name to the local test server, which the default policy would never allow. */
const local = (extra: SafeFetcherPolicy = {}): SafeFetcherPolicy => ({
  resolve: async () => [{ address: "127.0.0.1", family: 4 }],
  allowAddress: (address) => address === "127.0.0.1",
  allowPort: () => true,
  timeoutMs: 2000,
  ...extra,
});

const html: FetchOptions = { domain: "shop.test", allowedTypes: ["text/html"], maxBytes: 10_000 };
const url = (path = "/") => `http://shop.test:${port}${path}`;

async function refusal(promise: Promise<unknown>): Promise<FetchFailure> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof FetchRefusedError) return error.code;
    throw error;
  }
  throw new Error("expected the fetch to be refused");
}

describe("safe fetcher: ordinary requests", () => {
  it("fetches a page from the authorised domain", async () => {
    handler = (_req, res) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end("<h1>Hello</h1>");
    };
    const result = await createSafeFetcher(local()).fetch(url("/page"), html);
    expect(result).toMatchObject({ status: 200, contentType: "text/html" });
    expect(result.body.toString()).toBe("<h1>Hello</h1>");
  });

  it("identifies itself, refuses compression and sends no cookies", async () => {
    let seen: http.IncomingHttpHeaders = {};
    handler = (req, res) => {
      seen = req.headers;
      res.setHeader("Content-Type", "text/html");
      res.end("x");
    };
    await createSafeFetcher(local()).fetch(url(), html);
    expect(seen["user-agent"]).toMatch(/^KreateSpaceImporter\//);
    expect(seen["accept-encoding"]).toBe("identity");
    expect(seen.cookie).toBeUndefined();
    expect(seen.authorization).toBeUndefined();
  });

  it("follows a redirect within the same domain", async () => {
    handler = (req, res) => {
      if (req.url === "/old") {
        res.statusCode = 301;
        res.setHeader("Location", "/new");
        res.end();
        return;
      }
      res.setHeader("Content-Type", "text/html");
      res.end("moved");
    };
    const result = await createSafeFetcher(local()).fetch(url("/old"), html);
    expect(result.url).toBe(url("/new"));
    expect(result.body.toString()).toBe("moved");
  });
});

describe("safe fetcher: addresses", () => {
  const addresses = [
    "127.0.0.1",
    "10.0.0.5",
    "192.168.0.10",
    "169.254.169.254",
    "100.64.0.1",
    "::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ];

  it.each(addresses)("never connects to a name that resolves to %s", async (address) => {
    const before = hits.length;
    const fetcher = createSafeFetcher({
      resolve: async () => [{ address, family: address.includes(":") ? 6 : 4 }],
      allowPort: () => true,
      timeoutMs: 2000,
    });
    expect(await refusal(fetcher.fetch(url(), html))).toBe("BLOCKED_ADDRESS");
    expect(hits.length).toBe(before);
  });

  it("refuses a mixed answer, where one address is public and one internal", async () => {
    const fetcher = createSafeFetcher({
      resolve: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ],
      allowPort: () => true,
      timeoutMs: 2000,
    });
    expect(await refusal(fetcher.fetch(url(), html))).toBe("BLOCKED_ADDRESS");
  });

  it("refuses literal internal addresses without asking DNS", async () => {
    let asked = false;
    const fetcher = createSafeFetcher({
      resolve: async () => {
        asked = true;
        return [];
      },
      allowPort: () => true,
    });
    for (const host of ["169.254.169.254", "127.0.0.1", "10.0.0.1", "[::1]", "[::ffff:7f00:1]"]) {
      const code = await refusal(
        fetcher.fetch(`http://${host}/latest/meta-data`, {
          ...html,
          domain: host.replace(/^\[|\]$/g, ""),
        }),
      );
      expect(code, host).toBe("BLOCKED_ADDRESS");
    }
    expect(asked).toBe(false);
  });

  it("checks the address again on every connection, so DNS cannot change its answer (rebinding)", async () => {
    let calls = 0;
    handler = (req, res) => {
      if (req.url === "/start") {
        res.statusCode = 302;
        res.setHeader("Location", "/second");
        res.end();
        return;
      }
      res.setHeader("Content-Type", "text/html");
      res.end("should never be served");
    };
    const fetcher = createSafeFetcher({
      // The first lookup is fine; by the second the name points at an internal address.
      resolve: async () => [{ address: ++calls === 1 ? "127.0.0.1" : "10.0.0.1", family: 4 }],
      allowAddress: (address) => address === "127.0.0.1",
      allowPort: () => true,
      timeoutMs: 2000,
    });
    const before = hits.length;
    expect(await refusal(fetcher.fetch(url("/start"), html))).toBe("BLOCKED_ADDRESS");
    expect(hits.slice(before)).toEqual([`shop.test:${port}/start`]);
  });

  it("treats a failed lookup as unreachable, not as a crash", async () => {
    const fetcher = createSafeFetcher({
      resolve: async () => {
        throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
      },
      allowPort: () => true,
    });
    expect(await refusal(fetcher.fetch(url(), html))).toBe("UNREACHABLE");
  });
});

describe("safe fetcher: addresses and ports in the URL", () => {
  const strict = createSafeFetcher({
    resolve: async () => [{ address: "93.184.216.34", family: 4 }],
  });

  it("allows only the standard ports", async () => {
    for (const bad of [
      "http://shop.test:8080/",
      "https://shop.test:8443/",
      "http://shop.test:22/",
      "https://shop.test:80/",
    ]) {
      expect(await refusal(strict.fetch(bad, html)), bad).toBe("UNSUPPORTED_PORT");
    }
  });

  it("allows only web addresses without credentials", async () => {
    for (const bad of [
      "ftp://shop.test/",
      "file:///etc/passwd",
      "gopher://shop.test/",
      "javascript:alert(1)",
      "not a url",
      "",
    ]) {
      expect(await refusal(strict.fetch(bad, html)), bad).toBe("INVALID_URL");
    }
    expect(await refusal(strict.fetch("https://user:pass@shop.test/", html))).toBe("INVALID_URL");
  });

  it("refuses hosts outside the authorised domain, including look-alikes", async () => {
    for (const bad of [
      "https://other.test/",
      "https://evilshop.test/",
      "https://shop.test.evil.com/",
      "https://shop.test@evil.com/",
    ]) {
      const code = await refusal(strict.fetch(bad, html));
      expect(["NOT_AUTHORIZED", "INVALID_URL"], bad).toContain(code);
    }
  });

  it("refuses internal host names even before DNS", async () => {
    for (const domain of ["localhost", "db.internal", "printer.local"]) {
      expect(await refusal(strict.fetch(`http://${domain}/`, { ...html, domain })), domain).toBe(
        "BLOCKED_ADDRESS",
      );
    }
  });
});

describe("safe fetcher: redirects", () => {
  const redirectTo =
    (location: string): Handler =>
    (_req, res) => {
      res.statusCode = 302;
      res.setHeader("Location", location);
      res.end();
    };

  it("refuses a redirect to another website", async () => {
    handler = redirectTo("https://evil.example.com/steal");
    expect(await refusal(createSafeFetcher(local()).fetch(url(), html))).toBe("NOT_AUTHORIZED");
  });

  it("refuses a redirect to an internal address", async () => {
    for (const target of [
      "http://169.254.169.254/latest/meta-data/",
      "http://127.0.0.1:6379/",
      "http://[::1]/",
    ]) {
      handler = redirectTo(target);
      expect(await refusal(createSafeFetcher(local()).fetch(url(), html)), target).toBe(
        "NOT_AUTHORIZED",
      );
    }
  });

  it("refuses a redirect loop", async () => {
    handler = redirectTo("/again");
    expect(await refusal(createSafeFetcher(local({ maxRedirects: 3 })).fetch(url(), html))).toBe(
      "TOO_MANY_REDIRECTS",
    );
  });

  it("refuses a redirect with no destination", async () => {
    handler = (_req, res) => {
      res.statusCode = 302;
      res.end();
    };
    expect(await refusal(createSafeFetcher(local()).fetch(url(), html))).toBe("HTTP_ERROR");
  });
});

describe("safe fetcher: responses", () => {
  it("gives up when the website is too slow", async () => {
    handler = () => {
      /* never answers */
    };
    expect(await refusal(createSafeFetcher(local({ timeoutMs: 150 })).fetch(url(), html))).toBe(
      "TIMEOUT",
    );
  });

  it("gives up on a website that stalls after sending headers", async () => {
    handler = (_req, res) => {
      res.setHeader("Content-Type", "text/html");
      res.write("partial");
    };
    expect(await refusal(createSafeFetcher(local({ timeoutMs: 200 })).fetch(url(), html))).toBe(
      "TIMEOUT",
    );
  });

  it("refuses a body bigger than the limit, declared or not", async () => {
    handler = (_req, res) => {
      res.setHeader("Content-Type", "text/html");
      res.setHeader("Content-Length", "50000");
      res.end("x".repeat(50_000));
    };
    expect(await refusal(createSafeFetcher(local()).fetch(url(), html))).toBe("TOO_LARGE");

    handler = (_req, res) => {
      res.setHeader("Content-Type", "text/html");
      res.write("x".repeat(6000));
      res.write("x".repeat(6000));
      res.end();
    };
    expect(await refusal(createSafeFetcher(local()).fetch(url(), html))).toBe("TOO_LARGE");
  });

  it("refuses content types that were not asked for", async () => {
    for (const type of [
      "application/octet-stream",
      "application/javascript",
      "image/svg+xml",
      "",
    ]) {
      handler = (_req, res) => {
        if (type) res.setHeader("Content-Type", type);
        res.end("data");
      };
      expect(await refusal(createSafeFetcher(local()).fetch(url(), html)), type).toBe(
        "UNSUPPORTED_TYPE",
      );
    }
  });

  it("reports website errors without leaking anything internal", async () => {
    handler = (_req, res) => {
      res.statusCode = 500;
      res.end("stack trace at /srv/app/secret.js");
    };
    try {
      await createSafeFetcher(local()).fetch(url(), html);
      throw new Error("should have failed");
    } catch (error) {
      expect(error).toBeInstanceOf(FetchRefusedError);
      expect((error as Error).message).not.toContain("secret");
      expect((error as FetchRefusedError).code).toBe("HTTP_ERROR");
    }
  });
});
