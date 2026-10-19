-- A business may have at most 20 active (non-archived) creations. Enforced here as well as in the
-- API, with a per-business advisory lock so simultaneous requests cannot both slip under the limit.
CREATE OR REPLACE FUNCTION enforce_creation_limit() RETURNS trigger AS $$
DECLARE
  active_count integer;
BEGIN
  IF TG_OP = 'UPDATE' AND NOT (OLD."status" = 'ARCHIVED' AND NEW."status" <> 'ARCHIVED') THEN
    RETURN NEW;
  END IF;
  IF NEW."status" = 'ARCHIVED' THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('creations:' || NEW."businessId"::text));
  SELECT count(*) INTO active_count FROM "creations"
    WHERE "businessId" = NEW."businessId" AND "status" <> 'ARCHIVED' AND "id" <> NEW."id";
  IF active_count >= 20 THEN
    RAISE EXCEPTION 'creation_limit_reached' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "creations_limit_insert" BEFORE INSERT ON "creations"
  FOR EACH ROW EXECUTE FUNCTION enforce_creation_limit();
CREATE TRIGGER "creations_limit_restore" BEFORE UPDATE OF "status" ON "creations"
  FOR EACH ROW EXECUTE FUNCTION enforce_creation_limit();
