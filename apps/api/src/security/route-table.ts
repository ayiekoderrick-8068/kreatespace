/**
 * Every API route and who may use it. Shared by the tests that prove authorization is enforced. When a
 * route is added to the API it must be added here, or a test fails.
 */

export type Method = "get" | "post" | "patch" | "put" | "delete";
export type Role = "ADMIN" | "SELLER";
export const ID = "{id}";
export const IMAGE = "{imageId}";

export const adminRoutes: [Method, string][] = [
  ["get", "/api/admin/invitations"],
  ["post", "/api/admin/invitations"],
  ["post", `/api/admin/invitations/${ID}/revoke`],
  ["get", "/api/admin/businesses"],
  ["get", `/api/admin/businesses/${ID}`],
  ["post", `/api/admin/businesses/${ID}/decision`],
  ["get", "/api/admin/creations"],
  ["get", `/api/admin/creations/${ID}`],
  ["post", `/api/admin/creations/${ID}/decision`],
  ["get", "/api/admin/packages"],
  ["get", `/api/admin/packages/${ID}`],
  ["post", `/api/admin/packages/${ID}/decision`],
  ["get", "/api/admin/analytics"],
  ["get", "/api/admin/website-requests"],
  ["get", `/api/admin/website-requests/${ID}`],
  ["patch", `/api/admin/website-requests/${ID}`],
  ["get", "/api/admin/imports/authorizations"],
  ["post", "/api/admin/imports/authorizations"],
  ["delete", `/api/admin/imports/authorizations/${ID}`],
  ["get", "/api/admin/imports/jobs"],
  ["post", "/api/admin/imports/jobs"],
  ["get", "/api/admin/imports/items"],
  ["get", `/api/admin/imports/items/${ID}`],
  ["post", `/api/admin/imports/items/${ID}/accept`],
  ["post", `/api/admin/imports/items/${ID}/reject`],
  ["get", "/api/admin/deletions"],
  ["post", `/api/admin/deletions/${ID}/decision`],
];

export const sellerRoutes: [Method, string][] = [
  ["get", "/api/businesses/me"],
  ["post", "/api/businesses"],
  ["patch", "/api/businesses/me"],
  ["post", "/api/businesses/me/revisions"],
  ["post", "/api/businesses/me/uploads"],
  ["post", "/api/businesses/me/submit"],
  ["get", "/api/creations"],
  ["post", "/api/creations"],
  ["get", `/api/creations/${ID}`],
  ["patch", `/api/creations/${ID}`],
  ["post", `/api/creations/${ID}/submit`],
  ["post", `/api/creations/${ID}/revisions`],
  ["post", `/api/creations/${ID}/archive`],
  ["post", `/api/creations/${ID}/uploads`],
  ["post", `/api/creations/${ID}/images`],
  ["put", `/api/creations/${ID}/images/order`],
  ["delete", `/api/creations/${ID}/images/${IMAGE}`],
  ["get", "/api/packages"],
  ["post", "/api/packages"],
  ["get", `/api/packages/${ID}`],
  ["patch", `/api/packages/${ID}`],
  ["post", `/api/packages/${ID}/submit`],
  ["post", `/api/packages/${ID}/archive`],
  ["post", `/api/packages/${ID}/image-upload`],
  ["post", `/api/packages/${ID}/image`],
  ["delete", `/api/packages/${ID}/image`],
  ["get", "/api/analytics"],
  ["get", "/api/website-requests"],
  ["post", "/api/website-requests"],
  ["post", `/api/website-requests/${ID}/cancel`],
];

/** Any signed-in account may use these; there is no role check, only authentication. */
export const signedInRoutes: [Method, string][] = [
  ["post", "/api/invitations/accept"],
  ["get", "/api/me/saved"],
  ["get", "/api/me/saved/ids"],
  ["put", `/api/me/saved/${ID}`],
  ["delete", `/api/me/saved/${ID}`],
  ["get", "/api/me/deletion"],
  ["post", "/api/me/deletion"],
  ["delete", "/api/me/deletion"],
  ["get", "/api/me/export"],
];

/** Open to everyone on purpose: published content, filters, and anonymous analytics events. */
export const publicRouteCount = 16; // 6 discovery, 1 business profile, 5 search-engine routes, categories, occasions, event intake, invitation lookup
