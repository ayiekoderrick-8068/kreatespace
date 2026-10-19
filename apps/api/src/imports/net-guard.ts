import { BlockList, isIP } from "node:net";

/**
 * Network ranges the importer must never contact: loopback, private networks, link-local
 * (including cloud metadata at 169.254.169.254), carrier-grade NAT, documentation and reserved
 * space, multicast and broadcast. Only publicly routable addresses are allowed.
 */
const blocked = new BlockList();

const V4: [string, number][] = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay (deprecated)
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, includes broadcast
];
for (const [network, prefix] of V4) blocked.addSubnet(network, prefix, "ipv4");

const V6: [string, number][] = [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["100::", 64], // discard-only
  ["2001::", 23], // IETF protocol assignments, Teredo
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4 (embeds an IPv4 address)
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local (deprecated)
  ["ff00::", 8], // multicast
];
for (const [network, prefix] of V6) blocked.addSubnet(network, prefix, "ipv6");

/** The IPv4 address hidden inside an IPv6 one (mapped, NAT64), or null. */
function embeddedIPv4(address: string): string | null {
  const lower = address.toLowerCase();
  // ::ffff:1.2.3.4 and ::ffff:0102:0304
  const mapped = /^(?:0{0,4}:){0,5}ffff:(.+)$/.exec(lower) ?? /^::ffff:(.+)$/.exec(lower);
  const nat64 = /^64:ff9b::(.+)$/.exec(lower);
  const tail = mapped?.[1] ?? nat64?.[1];
  if (!tail) return null;
  if (isIP(tail) === 4) return tail;
  const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(tail);
  if (!hex) return null;
  const high = parseInt(hex[1]!, 16);
  const low = parseInt(hex[2]!, 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

/** True only for a publicly routable IPv4 or IPv6 address. Anything unparseable is refused. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  if (family === 4) return !blocked.check(address, "ipv4");

  const inner = embeddedIPv4(address);
  if (inner) return isPublicAddress(inner);
  return !blocked.check(address, "ipv6");
}

/** Hostnames that name the local machine or internal networks, whatever DNS says. */
export function isInternalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan") ||
    host.endsWith(".home.arpa") ||
    !host.includes(".")
  );
}

/** Registrable suffixes shared by many unrelated people; a business can never "own" these. */
const SHARED_SUFFIXES = new Set([
  "ke",
  "co.ke",
  "or.ke",
  "go.ke",
  "ac.ke",
  "ne.ke",
  "sc.ke",
  "me.ke",
  "mobi.ke",
  "info.ke",
  "vercel.app",
  "netlify.app",
  "github.io",
  "pages.dev",
  "web.app",
  "firebaseapp.com",
  "herokuapp.com",
  "onrender.com",
  "wixsite.com",
  "blogspot.com",
  "wordpress.com",
  "weebly.com",
  "myshopify.com",
  "squarespace.com",
]);

export function isSharedSuffix(domain: string): boolean {
  return SHARED_SUFFIXES.has(domain.toLowerCase());
}

/** Lower-case host without a trailing dot or a leading `www.`. */
export function normalizeDomain(host: string): string {
  return host
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "");
}

/** Whether `host` is the authorised domain, its `www.` form, or one of its subdomains. */
export function hostMatchesDomain(host: string, domain: string): boolean {
  const normalized = host.toLowerCase().replace(/\.$/, "");
  const base = domain.toLowerCase();
  return normalized === base || normalized === `www.${base}` || normalized.endsWith(`.${base}`);
}
