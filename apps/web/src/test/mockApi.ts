import { vi } from "vitest";

export interface MockResponse {
  status?: number;
  body?: unknown;
}
type Handler = MockResponse | ((request: { body: unknown; url: URL }) => MockResponse);

export interface RecordedCall {
  method: string;
  path: string;
  body: unknown;
  authorization: string | null;
}

/**
 * Replaces `fetch` with a router keyed by "METHOD /path". Unmatched requests get a 404 so
 * accidental calls are visible in `calls`.
 */
export function mockApi(routes: Record<string, Handler> = {}) {
  const calls: RecordedCall[] = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const headers = new Headers(init?.headers);
    calls.push({
      method,
      path: url.pathname + url.search,
      body,
      authorization: headers.get("Authorization"),
    });

    const handler =
      routes[`${method} ${url.pathname}${url.search}`] ?? routes[`${method} ${url.pathname}`];
    const result: MockResponse = handler
      ? typeof handler === "function"
        ? handler({ body, url })
        : handler
      : { status: 404, body: { error: { code: "NOT_FOUND", message: "Resource not found" } } };

    return new Response(JSON.stringify(result.body ?? {}), {
      status: result.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  vi.stubGlobal("fetch", fetchMock);
  return {
    calls,
    fetchMock,
    find: (method: string, path: string) =>
      calls.filter((c) => c.method === method && c.path === path),
  };
}

export const user = (role: "CUSTOMER" | "SELLER" | "ADMIN", email = "maria@example.com") => ({
  status: 200,
  body: { user: { id: "user-1", email, fullName: "Maria Wanjiku", role } },
});
