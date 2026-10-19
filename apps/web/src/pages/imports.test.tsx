import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { mockApi, user } from "../test/mockApi";
import { createFakeAuth, fakeSession, renderApp } from "../test/renderWithProviders";

const client = () => createFakeAuth(fakeSession()).client;

const authorization = {
  id: "a1",
  businessId: "b1",
  businessName: "Cakes by Maria",
  domain: "mariacakes.co.ke",
  createdAt: "2026-10-19T08:00:00.000Z",
  revokedAt: null,
};

const job = (overrides: Record<string, unknown> = {}) => ({
  id: "j1",
  businessName: "Cakes by Maria",
  domain: "mariacakes.co.ke",
  status: "COMPLETED",
  pagesFetched: 4,
  itemsFound: 2,
  duplicates: 1,
  skipped: 1,
  failure: null,
  createdAt: "2026-10-19T08:05:00.000Z",
  ...overrides,
});

const item = (overrides: Record<string, unknown> = {}) => ({
  id: "i1",
  businessName: "Cakes by Maria",
  sourceUrl: "https://mariacakes.co.ke/cakes/floral",
  title: "Floral Wedding Cake",
  description: "A three tier vanilla cake decorated with fresh flowers.",
  imageUrls: ["https://mariacakes.co.ke/img/floral.jpg"],
  status: "PENDING_REVIEW",
  duplicateReason: null,
  creationId: null,
  ...overrides,
});

const base = (extra: Record<string, unknown> = {}) => ({
  "GET /api/me": user("ADMIN"),
  "GET /api/categories": { body: { categories: [{ id: "cat1", slug: "cakes", name: "Cakes" }] } },
  "GET /api/occasions": { body: { occasions: [{ id: "occ1", slug: "wedding", name: "Wedding" }] } },
  "GET /api/admin/businesses?status=APPROVED": {
    body: {
      items: [{ id: "b1", businessName: "Cakes by Maria" }],
      total: 1,
      page: 1,
      pageSize: 20,
    },
  },
  "GET /api/admin/imports/authorizations": { body: { authorizations: [authorization] } },
  "GET /api/admin/imports/jobs": { body: { jobs: [job()] } },
  "GET /api/admin/imports/items?status=PENDING_REVIEW": { body: { items: [item()] } },
  ...extra,
});

describe("admin website imports", () => {
  it("shows authorised websites, import results and the pages waiting for review", async () => {
    mockApi(base() as never);
    renderApp("/admin/imports", client());

    const sites = await screen.findByRole("list", { name: "Authorised websites" });
    expect(within(sites).getByText("mariacakes.co.ke")).toBeInTheDocument();
    const jobs = await screen.findByRole("table");
    expect(within(jobs).getByText("Completed")).toBeInTheDocument();
    expect(within(jobs).getByText("mariacakes.co.ke")).toBeInTheDocument();

    const pages = await screen.findByRole("list", { name: "Pages found" });
    expect(within(pages).getByText("Floral Wedding Cake")).toBeInTheDocument();
    // The source is a link to the seller's own site; its photos are never loaded into the admin page.
    expect(
      within(pages).getByRole("link", { name: /mariacakes.co.ke\/cakes\/floral/ }),
    ).toHaveAttribute("rel", "noopener noreferrer");
    expect(document.querySelector("img")).toBeNull();
    expect(within(pages).getByText(/1 photo found/)).toBeInTheDocument();
    expect(within(pages).getByText(/private draft/)).toBeInTheDocument();
  });

  it("authorises a business and starts an import", async () => {
    const api = mockApi(
      base({
        "POST /api/admin/imports/authorizations": {
          status: 201,
          body: { id: "a2", domain: "mariacakes.co.ke" },
        },
        "POST /api/admin/imports/jobs": { status: 202, body: { id: "j2", status: "QUEUED" } },
      }) as never,
    );
    renderApp("/admin/imports", client());
    const form = await screen.findByRole("form", { name: "Authorise a website" });
    const submit = within(form).getByRole("button", { name: "Authorise website" });
    expect(submit).toBeDisabled();
    await waitFor(() =>
      expect(within(form).getByRole("option", { name: "Cakes by Maria" })).toBeInTheDocument(),
    );
    await userEvent.selectOptions(within(form).getByLabelText("Business"), "b1");
    await userEvent.click(submit);
    await waitFor(() =>
      expect(api.find("POST", "/api/admin/imports/authorizations")[0]!.body).toEqual({
        businessId: "b1",
      }),
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "Start an import for Cakes by Maria" }),
    );
    expect(await screen.findByText("Import started for mariacakes.co.ke.")).toBeInTheDocument();
    expect(api.find("POST", "/api/admin/imports/jobs")[0]!.body).toEqual({ authorizationId: "a1" });
  });

  it("shows a refusal from the server in plain words", async () => {
    mockApi(
      base({
        "POST /api/admin/imports/authorizations": {
          status: 409,
          body: {
            error: { code: "NO_WEBSITE", message: "This business has not listed a website." },
          },
        },
      }) as never,
    );
    renderApp("/admin/imports", client());
    const form = await screen.findByRole("form", { name: "Authorise a website" });
    await waitFor(() =>
      expect(within(form).getByRole("option", { name: "Cakes by Maria" })).toBeInTheDocument(),
    );
    await userEvent.selectOptions(within(form).getByLabelText("Business"), "b1");
    await userEvent.click(within(form).getByRole("button", { name: "Authorise website" }));
    expect(await screen.findByText("This business has not listed a website.")).toBeInTheDocument();
  });

  it("asks before revoking an authorisation", async () => {
    const api = mockApi(
      base({ "DELETE /api/admin/imports/authorizations/a1": { status: 204, body: {} } }) as never,
    );
    renderApp("/admin/imports", client());
    await userEvent.click(await screen.findByRole("button", { name: "Revoke mariacakes.co.ke" }));
    expect(api.find("DELETE", "/api/admin/imports/authorizations/a1")).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Yes, revoke" }));
    await waitFor(() =>
      expect(api.find("DELETE", "/api/admin/imports/authorizations/a1")).toHaveLength(1),
    );
  });

  it("reports failed imports with a safe message and no technical detail", async () => {
    mockApi(
      base({
        "GET /api/admin/imports/jobs": {
          body: {
            jobs: [
              job({ status: "FAILED", failure: "The website’s address can’t be imported from." }),
            ],
          },
        },
      }) as never,
    );
    renderApp("/admin/imports", client());
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Failed")).toBeInTheDocument();
    expect(
      within(table).getByText("The website’s address can’t be imported from."),
    ).toBeInTheDocument();
  });

  it("needs a category, then creates a draft and says what happens next", async () => {
    const api = mockApi(
      base({
        "POST /api/admin/imports/items/i1/accept": {
          status: 201,
          body: { creationId: "c1", imagesImported: 1, imagesSkipped: 0 },
        },
      }) as never,
    );
    renderApp("/admin/imports", client());
    const pages = await screen.findByRole("list", { name: "Pages found" });

    await userEvent.click(within(pages).getByRole("button", { name: "Import as draft" }));
    expect(await within(pages).findByText("Choose a category first.")).toBeInTheDocument();
    expect(api.find("POST", "/api/admin/imports/items/i1/accept")).toHaveLength(0);

    await waitFor(() =>
      expect(within(pages).getByRole("option", { name: "Cakes" })).toBeInTheDocument(),
    );
    await userEvent.selectOptions(within(pages).getByLabelText(/Category/), "cat1");
    await userEvent.selectOptions(within(pages).getByLabelText(/Occasion/), "occ1");
    await userEvent.click(within(pages).getByRole("button", { name: "Import as draft" }));
    expect(await within(pages).findByText(/Draft created with 1 photo/)).toBeInTheDocument();
    expect(api.find("POST", "/api/admin/imports/items/i1/accept")[0]!.body).toEqual({
      categoryId: "cat1",
      occasionId: "occ1",
    });
  });

  it("makes a suspected duplicate need explicit confirmation", async () => {
    const api = mockApi(
      base({
        "GET /api/admin/imports/items?status=PENDING_REVIEW": {
          body: {
            items: [
              item({
                status: "DUPLICATE",
                duplicateReason: "A creation with the same title already exists.",
              }),
            ],
          },
        },
        "POST /api/admin/imports/items/i1/accept": {
          status: 201,
          body: { creationId: "c1", imagesImported: 1, imagesSkipped: 1 },
        },
      }) as never,
    );
    renderApp("/admin/imports", client());
    const pages = await screen.findByRole("list", { name: "Pages found" });
    expect(within(pages).getByText(/same title already exists/)).toBeInTheDocument();
    await waitFor(() =>
      expect(within(pages).getByRole("option", { name: "Cakes" })).toBeInTheDocument(),
    );
    await userEvent.selectOptions(within(pages).getByLabelText(/Category/), "cat1");
    await userEvent.click(within(pages).getByLabelText("Import it anyway"));
    await userEvent.click(within(pages).getByRole("button", { name: "Import as draft" }));
    expect(await within(pages).findByText(/1 skipped/)).toBeInTheDocument();
    expect(api.find("POST", "/api/admin/imports/items/i1/accept")[0]!.body).toMatchObject({
      confirmDuplicate: true,
    });
  });

  it("rejects a page and surfaces errors from the server", async () => {
    const api = mockApi(
      base({
        "POST /api/admin/imports/items/i1/reject": {
          status: 409,
          body: {
            error: { code: "ITEM_DECIDED", message: "This page has already been reviewed." },
          },
        },
      }) as never,
    );
    renderApp("/admin/imports", client());
    const pages = await screen.findByRole("list", { name: "Pages found" });
    await userEvent.click(within(pages).getByRole("button", { name: "Reject" }));
    expect(
      await within(pages).findByText("This page has already been reviewed."),
    ).toBeInTheDocument();
    expect(api.find("POST", "/api/admin/imports/items/i1/reject")).toHaveLength(1);
  });

  it("is closed to sellers", async () => {
    mockApi({ "GET /api/me": user("SELLER") });
    renderApp("/admin/imports", client());
    await waitFor(() => expect(screen.queryByText("Website imports")).not.toBeInTheDocument());
  });
});
