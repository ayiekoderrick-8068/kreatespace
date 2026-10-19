-- Search used to build the text-search document of every public creation on every query, so its
-- time grew with the catalogue (about 1.5 s at 20,000 creations). The document is now stored on
-- each creation and kept up to date by the database itself, whichever code changes the data.

-- AlterTable
ALTER TABLE "creations" ADD COLUMN "searchDocument" tsvector;

-- What a customer's words are matched against: the creation's published title and description, its
-- business's published name, and the category and occasion names. Null when nothing is published.
CREATE FUNCTION "kreatespace_search_document"(p_revision uuid, p_business uuid) RETURNS tsvector
LANGUAGE sql STABLE AS $$
  SELECT to_tsvector('english',
    cr."title" || ' ' || cr."description" || ' ' || coalesce(br."businessName", '') || ' ' ||
    cat."name" || ' ' || coalesce(o."name", ''))
  FROM "creation_revisions" cr
  JOIN "categories" cat ON cat."id" = cr."categoryId"
  LEFT JOIN "occasions" o ON o."id" = cr."occasionId"
  LEFT JOIN "businesses" b ON b."id" = p_business
  LEFT JOIN "business_revisions" br ON br."id" = b."publishedRevisionId"
  WHERE cr."id" = p_revision
$$;

-- A creation is published, republished or moved: recompute its own document.
CREATE FUNCTION "kreatespace_creation_search_trigger"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."searchDocument" := "kreatespace_search_document"(NEW."publishedRevisionId", NEW."businessId");
  RETURN NEW;
END $$;

CREATE TRIGGER "creations_search_document"
  BEFORE INSERT OR UPDATE OF "publishedRevisionId", "businessId" ON "creations"
  FOR EACH ROW EXECUTE FUNCTION "kreatespace_creation_search_trigger"();

-- Something the document is built from changes: recompute the creations that show it.
CREATE FUNCTION "kreatespace_business_search_trigger"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "creations" SET "searchDocument" =
    "kreatespace_search_document"("publishedRevisionId", "businessId")
  WHERE "businessId" = NEW."id";
  RETURN NULL;
END $$;

CREATE TRIGGER "businesses_search_document"
  AFTER UPDATE OF "publishedRevisionId" ON "businesses"
  FOR EACH ROW EXECUTE FUNCTION "kreatespace_business_search_trigger"();

CREATE FUNCTION "kreatespace_business_revision_search_trigger"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "creations" c SET "searchDocument" =
    "kreatespace_search_document"(c."publishedRevisionId", c."businessId")
  FROM "businesses" b
  WHERE b."publishedRevisionId" = NEW."id" AND c."businessId" = b."id";
  RETURN NULL;
END $$;

CREATE TRIGGER "business_revisions_search_document"
  AFTER UPDATE OF "businessName" ON "business_revisions"
  FOR EACH ROW EXECUTE FUNCTION "kreatespace_business_revision_search_trigger"();

CREATE FUNCTION "kreatespace_creation_revision_search_trigger"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "creations" SET "searchDocument" =
    "kreatespace_search_document"("publishedRevisionId", "businessId")
  WHERE "publishedRevisionId" = NEW."id";
  RETURN NULL;
END $$;

CREATE TRIGGER "creation_revisions_search_document"
  AFTER UPDATE OF "title", "description", "categoryId", "occasionId" ON "creation_revisions"
  FOR EACH ROW EXECUTE FUNCTION "kreatespace_creation_revision_search_trigger"();

CREATE FUNCTION "kreatespace_category_search_trigger"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "creations" c SET "searchDocument" =
    "kreatespace_search_document"(c."publishedRevisionId", c."businessId")
  FROM "creation_revisions" cr
  WHERE cr."categoryId" = NEW."id" AND c."publishedRevisionId" = cr."id";
  RETURN NULL;
END $$;

CREATE TRIGGER "categories_search_document"
  AFTER UPDATE OF "name" ON "categories"
  FOR EACH ROW EXECUTE FUNCTION "kreatespace_category_search_trigger"();

CREATE FUNCTION "kreatespace_occasion_search_trigger"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "creations" c SET "searchDocument" =
    "kreatespace_search_document"(c."publishedRevisionId", c."businessId")
  FROM "creation_revisions" cr
  WHERE cr."occasionId" = NEW."id" AND c."publishedRevisionId" = cr."id";
  RETURN NULL;
END $$;

CREATE TRIGGER "occasions_search_document"
  AFTER UPDATE OF "name" ON "occasions"
  FOR EACH ROW EXECUTE FUNCTION "kreatespace_occasion_search_trigger"();

-- On Supabase, functions in the public schema can be called through the REST API by anyone with
-- the public key unless EXECUTE is taken away. The search function reads unpublished revisions, so
-- only the database owner (the API) may run these. Triggers do not need the privilege to fire.
REVOKE ALL ON FUNCTION "kreatespace_search_document"(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION "kreatespace_creation_search_trigger"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "kreatespace_business_search_trigger"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "kreatespace_business_revision_search_trigger"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "kreatespace_creation_revision_search_trigger"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "kreatespace_category_search_trigger"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "kreatespace_occasion_search_trigger"() FROM PUBLIC;

-- Existing creations.
UPDATE "creations" SET "searchDocument" =
  "kreatespace_search_document"("publishedRevisionId", "businessId");
