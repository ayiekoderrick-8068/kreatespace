// Checks that the website's content security policy (apps/web/vercel.json) works with the
// production build. It serves the built site (apps/web/dist) with exactly those headers, apart
// from swapping in a local API address, loads the main pages in a real browser, and fails if the
// browser reports a single policy violation or the policy lets through what it should block.
//
//   VITE_API_URL=http://127.0.0.1:4556 VITE_SUPABASE_URL=https://abc.supabase.co \
//   VITE_SUPABASE_ANON_KEY=anon pnpm --filter @kreatespace/web build
//   pnpm --filter @kreatespace/e2e check:csp
//
// Run it before each release, and whenever the policy or a dependency that touches the page
// (for example one that evaluates code at run time) changes.
/* eslint-disable */
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../../apps/web", import.meta.url));
const dist = join(root, "dist");
const config = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));
const API = "http://127.0.0.1:4556";

// The production policy, with only two local substitutions: the API host, and no forced https
// upgrade (this test server is plain http).
const csp = config.headers
  .find((h) => h.source === "/(.*)")
  .headers.find((h) => h.key === "Content-Security-Policy")
  .value.replace("https://__API_ORIGIN__", API)
  .replace("; upgrade-insecure-requests", "");
console.log("Policy under test:\n  " + csp.split("; ").join("\n  ") + "\n");

const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};
const server = createServer((req, res) => {
  const path = join(dist, decodeURIComponent((req.url ?? "/").split("?")[0]));
  const file = existsSync(path) && statSync(path).isFile() ? path : join(dist, "index.html");
  res.writeHead(200, {
    "Content-Type": types[extname(file)] ?? "application/octet-stream",
    "Content-Security-Policy": csp,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
  createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(4557, "127.0.0.1", resolve));

const browser = await chromium.launch();
const context = await browser.newContext({ baseURL: "http://127.0.0.1:4557" });
const violations = [];
const consoleErrors = [];

// Stand-ins for the API and Supabase, so pages render without any real service. Interception
// happens after the browser has already applied its policy, so violations are still reported.
await context.route(`${API}/**`, (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: {
      "Access-Control-Allow-Origin": "http://127.0.0.1:4557",
      "Access-Control-Allow-Credentials": "true",
    },
    body: JSON.stringify({
      items: [],
      categories: [],
      occasions: [],
      hasMore: false,
      page: 1,
      creations: [],
      businesses: [],
      recent: [],
    }),
  }),
);
await context.route("https://abc.supabase.co/**", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: { session: null } }),
  }),
);
await context.route("https://abc.supabase.co/storage/**", (route) =>
  route.fulfill({
    status: 200,
    contentType: "image/png",
    body: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    ),
  }),
);

const page = await context.newPage();
await page.addInitScript(() => {
  window.addEventListener("securitypolicyviolation", (event) => {
    (window.__violations ??= []).push(
      `${event.violatedDirective}: ${event.blockedURI || "inline"} (${event.sourceFile ?? ""})`,
    );
  });
});
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});

for (const path of [
  "/",
  "/explore",
  "/login",
  "/register",
  "/about",
  "/for-businesses",
  "/creations/not-a-real-id",
  "/businesses/nobody",
]) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  const found = await page.evaluate(() => window.__violations ?? []);
  const heading =
    (await page
      .locator("h1")
      .first()
      .textContent({ timeout: 3000 })
      .catch(() => null)) ?? "(no heading)";
  console.log(
    `${path.padEnd(28)} renders "${heading.trim().slice(0, 40)}"  violations: ${found.length}`,
  );
  violations.push(...found.map((v) => `${path} -> ${v}`));
  await page.evaluate(() => (window.__violations = []));
}

// An image from Supabase Storage must be allowed; one from anywhere else must be blocked.
const imageResults = await page.evaluate(async () => {
  const load = (src) =>
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve("loaded");
      img.onerror = () => resolve("blocked");
      img.src = src;
    });
  return {
    supabase: await load("https://abc.supabase.co/storage/v1/object/sign/x.png"),
    elsewhere: await load("https://example.com/x.png"),
  };
});
console.log(
  "\nimage from Supabase Storage:",
  imageResults.supabase,
  "| image from another site:",
  imageResults.elsewhere,
);

// Injected script must not run.
const injected = await page.evaluate(() => {
  window.__ran = false;
  const script = document.createElement("script");
  script.textContent = "window.__ran = true";
  document.body.appendChild(script);
  return window.__ran;
});
console.log("injected inline script ran:", injected);

console.log("\nCSP violations on real pages:", violations.length ? violations : "none");
console.log(
  "console errors mentioning the policy:",
  consoleErrors.filter((m) => /content security policy/i.test(m)).length,
);
await browser.close();
server.close();
process.exit(
  violations.length ||
    imageResults.supabase !== "loaded" ||
    imageResults.elsewhere !== "blocked" ||
    injected
    ? 1
    : 0,
);
