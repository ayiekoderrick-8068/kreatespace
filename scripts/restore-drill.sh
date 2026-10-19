#!/usr/bin/env bash
# Rehearses restoring a KreateSpace database backup, safely.
#
# It takes a backup of SOURCE_DATABASE_URL, restores it into a brand-new, throw-away database on
# SCRATCH_SERVER_URL, and checks that every table has the same number of rows and that row-level
# security survived. It only ever READS the source and only ever WRITES to the scratch database,
# which it creates, and drops again afterwards.
#
#   SOURCE_DATABASE_URL=postgresql://user:pass@host:5432/dbname \
#   SCRATCH_SERVER_URL=postgresql://user:pass@localhost:5432 \
#   ./scripts/restore-drill.sh
#
# Use a local PostgreSQL server (or a separate scratch project) as the scratch server, never the
# production one. Needs pg_dump, pg_restore and psql (PostgreSQL client tools, ideally the same
# major version as the server). Set KEEP=1 to keep the scratch database and the backup file.
set -euo pipefail

: "${SOURCE_DATABASE_URL:?Set SOURCE_DATABASE_URL to the database to back up}"
: "${SCRATCH_SERVER_URL:?Set SCRATCH_SERVER_URL to a server you can create a scratch database on (no database name)}"
SCRATCH_DB="${SCRATCH_DB:-kreatespace_restore_drill}"
case "$SCRATCH_DB" in
  *[!a-zA-Z0-9_]*|"") echo "SCRATCH_DB may contain only letters, digits and underscores" >&2; exit 2 ;;
esac

server="${SCRATCH_SERVER_URL%/}"
if [[ "$SOURCE_DATABASE_URL" == "$server/$SCRATCH_DB"* ]]; then
  echo "Refusing: the scratch database would be the same as the source." >&2
  exit 2
fi

workdir="$(mktemp -d)"
chmod 700 "$workdir"
backup="$workdir/backup.dump"
cleanup() {
  if [[ "${KEEP:-0}" != "1" ]]; then
    psql "$server/postgres" -qAt -c "DROP DATABASE IF EXISTS \"$SCRATCH_DB\"" >/dev/null 2>&1 || true
    rm -rf "$workdir"
  else
    echo "Kept: scratch database '$SCRATCH_DB' and $backup"
  fi
}
trap cleanup EXIT

# One "table|row count" line per table, in a stable order.
counts() {
  local url="$1" sql
  sql="$(psql "$SOURCE_DATABASE_URL" -qAt -c "
    SELECT string_agg(format('SELECT %L AS t, count(*) AS n FROM public.%I', tablename, tablename),
                      ' UNION ALL ' ORDER BY tablename)
    FROM pg_tables WHERE schemaname = 'public'")"
  psql "$url" -qAt -F '|' -c "SELECT t, n FROM ($sql) c ORDER BY t"
}

echo "1/5 Backing up (read-only on the source)..."
pg_dump --format=custom --no-owner --no-privileges --file="$backup" "$SOURCE_DATABASE_URL"
echo "    backup size: $(wc -c <"$backup") bytes"

echo "2/5 Creating the scratch database '$SCRATCH_DB'..."
psql "$server/postgres" -qAt -c "DROP DATABASE IF EXISTS \"$SCRATCH_DB\"" -c "CREATE DATABASE \"$SCRATCH_DB\"" >/dev/null

echo "3/5 Restoring into it..."
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$server/$SCRATCH_DB" "$backup"

echo "4/5 Comparing every table's row count..."
counts "$SOURCE_DATABASE_URL" >"$workdir/source.txt"
counts "$server/$SCRATCH_DB" >"$workdir/restored.txt"
if diff "$workdir/source.txt" "$workdir/restored.txt"; then
  echo "    all $(wc -l <"$workdir/source.txt") tables match"
else
  echo "FAILED: row counts differ between the source and the restored copy." >&2
  exit 1
fi

echo "5/5 Checking security settings survived..."
open_tables="$(psql "$server/$SCRATCH_DB" -qAt -c "
  SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity")"
if [[ "$open_tables" != "0" ]]; then
  echo "FAILED: $open_tables table(s) lost row-level security in the restore." >&2
  exit 1
fi
migrations="$(psql "$server/$SCRATCH_DB" -qAt -c "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL")"
echo "    row-level security intact; $migrations migrations recorded"

echo "Restore drill PASSED. Nothing in the source was changed."
