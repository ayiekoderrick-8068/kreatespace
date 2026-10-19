import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ANALYTICS_RETENTION_MONTHS,
  DELETION_GRACE_DAYS,
  LEGAL_VERSION,
  MAX_ACTIVE_CREATIONS,
} from "@kreatespace/shared";
import { mockApi } from "../test/mockApi";
import { renderApp } from "../test/renderWithProviders";

const DOCUMENTS = [
  { path: "/terms", title: "Terms of Use" },
  { path: "/privacy", title: "Privacy Policy" },
  { path: "/seller-terms", title: "Seller Terms" },
] as const;

beforeEach(() => {
  mockApi({});
  document.head.querySelectorAll('meta[name="robots"]').forEach((el) => el.remove());
});

describe.each(DOCUMENTS)("$title ($path)", ({ path, title }) => {
  it("can be read by anyone, without signing in", async () => {
    renderApp(path);
    expect(await screen.findByRole("heading", { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`Version ${LEGAL_VERSION}`))).toBeInTheDocument();
  });

  it("says plainly that it is a draft that has not been reviewed by a lawyer", async () => {
    renderApp(path);
    const notice = await screen.findByRole("note", { name: "Draft notice" });
    expect(notice).toHaveTextContent(/not\s+been reviewed by a lawyer/);
    expect(notice).toHaveTextContent(/not legal advice/);
  });

  it("marks every missing business detail as a highlighted placeholder, and invents none", async () => {
    renderApp(path);
    await screen.findByRole("heading", { level: 1, name: title });
    const marked = Array.from(document.querySelectorAll("mark")).map((m) => m.textContent ?? "");
    expect(marked.length).toBeGreaterThan(0);
    for (const text of marked) expect(text).toMatch(/^\[.*\]$/s);

    const text = document.body.textContent ?? "";
    // No made-up company name, address or registration number.
    expect(text).not.toMatch(/\b(Ltd|Limited|P\.?O\.?\s?Box)\b/);
    expect(text).not.toMatch(/\b(ODPC|Registration)\s*(No\.?|number)?\s*:?\s*\d{3,}/i);
    expect(text).not.toMatch(/\b[\w.+-]+@(?!example)[\w-]+\.(com|co\.ke|ke|org)\b/);
  });

  it("is built from numbered sections reachable from a contents list, with one top heading", async () => {
    renderApp(path);
    await screen.findByRole("heading", { level: 1, name: title });
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const contents = screen.getByRole("navigation", { name: "Contents" });
    const links = within(contents).getAllByRole("link");
    const sections = screen.getAllByRole("heading", { level: 2 });
    expect(links.length).toBe(sections.length);
    expect(sections.length).toBeGreaterThanOrEqual(8);
    for (const link of links) {
      const id = link.getAttribute("href")!.slice(1);
      expect(document.getElementById(id), id).not.toBeNull();
    }
    // Headings never skip a level.
    expect(document.querySelectorAll("h3, h4").length).toBe(0);
  });

  it("links to the other two documents", async () => {
    renderApp(path);
    const others = await screen.findByRole("navigation", { name: "Other documents" });
    for (const doc of DOCUMENTS) {
      expect(within(others).getByRole("link", { name: doc.title })).toHaveAttribute(
        "href",
        doc.path,
      );
    }
  });

  it("stays out of search results while it is a draft", async () => {
    renderApp(path);
    await screen.findByRole("heading", { level: 1, name: title });
    await vi_waitFor(() =>
      expect(document.head.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content).toBe(
        "noindex, nofollow",
      ),
    );
    expect(document.title).toBe(`${title} — KreateSpace`);
  });
});

describe("what the documents promise matches how the service behaves", () => {
  it("states the real deletion delay, retention period and limits", async () => {
    renderApp("/privacy");
    await screen.findByRole("heading", { level: 1, name: "Privacy Policy" });
    const text = document.body.textContent ?? "";
    expect(text).toContain(`${DELETION_GRACE_DAYS} days`);
    expect(text).toContain(`${ANALYTICS_RETENTION_MONTHS} months`);
    expect(text).toMatch(/WhatsApp messages never pass through KreateSpace/);
    expect(text).toMatch(/no IP address, device details, account, phone number\s+or message/i);
  });

  it("tells sellers the numbers they will actually meet", async () => {
    renderApp("/seller-terms");
    await screen.findByRole("heading", { level: 1, name: "Seller Terms" });
    const text = document.body.textContent ?? "";
    expect(text).toContain(`${MAX_ACTIVE_CREATIONS} active creations`);
    expect(text).toMatch(/Your WhatsApp\s+number is published/);
    expect(text).toMatch(/own website/);
  });

  it("says KreateSpace is not a party to dealings with businesses", async () => {
    renderApp("/terms");
    await screen.findByRole("heading", { level: 1, name: "Terms of Use" });
    expect(document.body.textContent).toMatch(/not a shop and is not a party/);
  });
});

describe("the footer", () => {
  it("links to every document from any page", async () => {
    renderApp("/about");
    const footer = await screen.findByRole("contentinfo");
    for (const doc of DOCUMENTS) {
      expect(within(footer).getByRole("link", { name: doc.title })).toHaveAttribute(
        "href",
        doc.path,
      );
    }
  });
});

// `waitFor` under a name that does not collide with the table above.
import { waitFor as vi_waitFor } from "@testing-library/react";
