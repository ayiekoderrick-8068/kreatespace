import { describe, expect, it } from "vitest";
import {
  hostMatchesDomain,
  isInternalHostname,
  isPublicAddress,
  isSharedSuffix,
  normalizeDomain,
} from "./net-guard.js";

describe("isPublicAddress", () => {
  it.each([
    "8.8.8.8",
    "41.90.1.1", // Kenya
    "196.201.214.200",
    "93.184.216.34",
    "2606:4700:4700::1111",
    "2a00:1450:4001:81b::200e",
  ])("allows public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    "127.0.0.1",
    "127.1.2.3",
    "0.0.0.0",
    "10.0.0.5",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata
    "100.64.0.1", // carrier-grade NAT
    "198.18.0.1",
    "192.0.2.10",
    "203.0.113.9",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    "2001:db8::1",
    "::ffff:127.0.0.1", // IPv4-mapped loopback
    "::ffff:7f00:1", // the same, in hex form
    "::ffff:10.1.2.3",
    "::ffff:a9fe:a9fe", // mapped 169.254.169.254
    "64:ff9b::7f00:1", // NAT64 to loopback
    "2002:7f00:1::1", // 6to4 range
  ])("refuses internal address %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it("refuses anything that is not an address", () => {
    for (const value of [
      "",
      "localhost",
      "example.com",
      "999.1.1.1",
      "1.2.3",
      "0x7f.1",
      "2130706433",
    ]) {
      expect(isPublicAddress(value), value).toBe(false);
    }
  });

  it("keeps the edges of private ranges exact", () => {
    expect(isPublicAddress("172.15.255.255")).toBe(true);
    expect(isPublicAddress("172.32.0.0")).toBe(true);
    expect(isPublicAddress("100.63.255.255")).toBe(true);
    expect(isPublicAddress("100.128.0.0")).toBe(true);
  });
});

describe("isInternalHostname", () => {
  it.each([
    "localhost",
    "app.localhost",
    "printer.local",
    "db.internal",
    "router.lan",
    "intranet",
    "x.home.arpa",
    "localhost.",
  ])("treats %s as internal", (host) => expect(isInternalHostname(host)).toBe(true));
  it.each(["example.com", "cakes.co.ke", "www.shop.example.org"])("treats %s as public", (host) =>
    expect(isInternalHostname(host)).toBe(false),
  );
});

describe("domain rules", () => {
  it("matches the domain, www and subdomains only", () => {
    expect(hostMatchesDomain("mariacakes.co.ke", "mariacakes.co.ke")).toBe(true);
    expect(hostMatchesDomain("www.mariacakes.co.ke", "mariacakes.co.ke")).toBe(true);
    expect(hostMatchesDomain("shop.mariacakes.co.ke", "mariacakes.co.ke")).toBe(true);
    expect(hostMatchesDomain("MariaCakes.co.ke.", "mariacakes.co.ke")).toBe(true);
    // Look-alikes and parents are not the same site.
    expect(hostMatchesDomain("evilmariacakes.co.ke", "mariacakes.co.ke")).toBe(false);
    expect(hostMatchesDomain("mariacakes.co.ke.evil.com", "mariacakes.co.ke")).toBe(false);
    expect(hostMatchesDomain("co.ke", "mariacakes.co.ke")).toBe(false);
    expect(hostMatchesDomain("127.0.0.1", "mariacakes.co.ke")).toBe(false);
  });

  it("recognises shared suffixes and normalises hosts", () => {
    expect(isSharedSuffix("vercel.app")).toBe(true);
    expect(isSharedSuffix("co.ke")).toBe(true);
    expect(isSharedSuffix("mariacakes.co.ke")).toBe(false);
    expect(normalizeDomain("WWW.Example.COM.")).toBe("example.com");
  });
});
