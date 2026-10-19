-- A creation revision holds at most 5 images. Enforced in the API and here, with an advisory
-- lock per revision so simultaneous inserts cannot exceed the limit.
CREATE OR REPLACE FUNCTION enforce_creation_image_limit() RETURNS trigger AS $$
DECLARE
  image_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('images:' || NEW."revisionId"::text));
  SELECT count(*) INTO image_count FROM "creation_images" WHERE "revisionId" = NEW."revisionId";
  IF image_count >= 5 THEN
    RAISE EXCEPTION 'image_limit_reached' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "creation_images_limit" BEFORE INSERT ON "creation_images"
  FOR EACH ROW EXECUTE FUNCTION enforce_creation_image_limit();
