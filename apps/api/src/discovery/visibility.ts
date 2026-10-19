import { Prisma } from "../generated/prisma/client.js";

/**
 * The one definition of "visible to the public". A creation appears only when
 *  - the creation itself is approved and has a published revision, and
 *  - its business is approved (not draft, pending, rejected or suspended) with a published profile.
 * Every public query uses this (Prisma form or SQL form), so rules cannot drift apart.
 */
export const visibleCreation = {
  status: "APPROVED",
  publishedRevisionId: { not: null },
  business: { status: "APPROVED", publishedRevisionId: { not: null } },
} satisfies Prisma.CreationWhereInput;

export const visibleBusiness = {
  status: "APPROVED",
  publishedRevisionId: { not: null },
} satisfies Prisma.BusinessWhereInput;

/** Joins every table the public feed reads. Aliases: c, cr, b, br, cat, o. */
export const visibleFromSql = Prisma.sql`
  FROM "creations" c
  JOIN "creation_revisions" cr ON cr."id" = c."publishedRevisionId"
  JOIN "businesses" b ON b."id" = c."businessId"
  JOIN "business_revisions" br ON br."id" = b."publishedRevisionId"
  JOIN "categories" cat ON cat."id" = cr."categoryId"
  LEFT JOIN "occasions" o ON o."id" = cr."occasionId"`;

/** SQL twin of `visibleCreation`. */
export const visibleWhereSql = Prisma.sql`
  c."status" = 'APPROVED' AND c."publishedRevisionId" IS NOT NULL
  AND b."status" = 'APPROVED' AND b."publishedRevisionId" IS NOT NULL`;
