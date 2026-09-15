#!/usr/bin/env bash
#
# Applies supabase/migrations/*.sql to a real PostgreSQL database — a hosted
# Supabase project, or the local stack — in filename order, exactly once each.
#
#   export SUPABASE_DB_URL='postgresql://postgres:PASSWORD@db.<ref>.supabase.co:5432/postgres'
#   npm run db:status      # what is applied, what is pending
#   npm run db:push        # apply the pending migrations
#   npm run db:verify      # assert the result looks the way it should
#
# Which migrations have run is recorded in supabase_migrations.schema_migrations,
# the same ledger the Supabase CLI uses, so the two agree about history and
# `supabase db push` will not try to replay anything applied here.
#
# The migrations are NOT individually idempotent (`create type` has no
# `if not exists`), which is why the ledger decides what runs rather than the
# files defending themselves. A migration and its ledger row are written in one
# transaction: a file that fails leaves no trace of itself in either.
#
# Requires: psql. No Supabase CLI, no Docker.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS="$ROOT/supabase/migrations"
COMMAND="${1:-status}"
ERRLOG="$(mktemp)"
trap 'rm -f "$ERRLOG"' EXIT

die() { echo "error: $*" >&2; exit 1; }

# Never print the password, in success or in failure.
redact() { sed -E 's#(://[^:/@]+):[^@]*@#\1:****@#g'; }

command -v psql > /dev/null || die "psql not found. Install the postgresql-client package."

DB_URL="${SUPABASE_DB_URL:-}"
if [ -z "$DB_URL" ] && [ -f "$ROOT/.env.local" ]; then
  DB_URL="$(grep -E '^SUPABASE_DB_URL=' "$ROOT/.env.local" | tail -1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/' || true)"
fi
[ -n "$DB_URL" ] || die "SUPABASE_DB_URL is not set.
  Supabase → Project Settings → Database → Connection string → URI, with your
  database password substituted for [YOUR-PASSWORD]:

    export SUPABASE_DB_URL='postgresql://postgres:PASSWORD@db.<ref>.supabase.co:5432/postgres'

  Keep it out of git: .env.local is ignored, .env.example is not."

PSQL=(psql "$DB_URL" -X -q -v ON_ERROR_STOP=1)
q() { "${PSQL[@]}" -At -c "$1"; }

# ---------------------------------------------------------------------------
# Preflight: fail before touching anything rather than halfway through.
# ---------------------------------------------------------------------------
preflight() {
  local err
  if ! err="$("${PSQL[@]}" -c 'select 1' 2>&1 > /dev/null)"; then
    echo "$err" | redact >&2
    die "cannot connect. Check the host, the password, and that your IP is allowed."
  fi

  local missing_roles
  missing_roles="$(q "select string_agg(r, ', ')
    from unnest(array['anon','authenticated','service_role']) r
    where not exists (select 1 from pg_roles where rolname = r)")"
  [ -z "$missing_roles" ] || die "this database is missing the Supabase roles: $missing_roles.
  The migrations grant and revoke against them, so they must exist first. Point
  SUPABASE_DB_URL at a Supabase project, or at the local stack
  (./scripts/local-stack.sh up), not at a bare PostgreSQL."

  [ "$(q "select to_regclass('auth.users') is not null")" = "t" ] \
    || die "auth.users does not exist. profiles references it; this is not a Supabase database."
}

ledger() {
  "${PSQL[@]}" <<'SQL' > /dev/null
set client_min_messages = warning;
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);
alter table supabase_migrations.schema_migrations add column if not exists statements text[];
alter table supabase_migrations.schema_migrations add column if not exists name text;
SQL
}

version_of() { basename "$1" .sql | cut -d_ -f1; }
name_of()    { basename "$1" .sql | cut -d_ -f2-; }

pending_files() {
  local applied f
  applied="$(q "select coalesce(string_agg(version, ' '), '') from supabase_migrations.schema_migrations")"
  for f in "$MIGRATIONS"/*.sql; do
    case " $applied " in
      *" $(version_of "$f") "*) ;;
      *) echo "$f" ;;
    esac
  done
}

apply_one() {
  local file="$1" version name tmp
  version="$(version_of "$file")"
  name="$(name_of "$file")"
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' RETURN
  {
    cat "$file"
    echo
    echo "insert into supabase_migrations.schema_migrations (version, name)"
    echo "values ('$version', '$name') on conflict (version) do nothing;"
  } > "$tmp"
  # --single-transaction + ON_ERROR_STOP: the schema change and the ledger row
  # land together, or neither does.
  "${PSQL[@]}" --single-transaction -f "$tmp" > /dev/null 2> "$ERRLOG"
}

case "$COMMAND" in
  status)
    preflight; ledger
    echo "target:  $(echo "$DB_URL" | redact)"
    echo "server:  $(q 'select version()' | cut -d, -f1)"
    echo
    printf '%-18s %-24s %s\n' VERSION NAME STATE
    for f in "$MIGRATIONS"/*.sql; do
      v="$(version_of "$f")"
      if [ "$(q "select exists (select 1 from supabase_migrations.schema_migrations where version = '$v')")" = "t" ]; then
        state=applied
      else
        state=PENDING
      fi
      printf '%-18s %-24s %s\n' "$v" "$(name_of "$f")" "$state"
    done
    ;;

  push)
    preflight; ledger
    echo "target:  $(echo "$DB_URL" | redact)"
    mapfile -t files < <(pending_files)
    if [ "${#files[@]}" -eq 0 ]; then
      echo "nothing to apply — every migration is already recorded."
      exit 0
    fi
    echo "applying ${#files[@]} migration(s):"
    for f in "${files[@]}"; do
      printf '  %-18s %-24s ' "$(version_of "$f")" "$(name_of "$f")"
      if apply_one "$f"; then
        echo "ok"
      else
        echo "FAILED"
        sed "s|$ERRLOG||; s|^psql:[^:]*:|  line |" "$ERRLOG" >&2
        die "$(basename "$f") failed and was rolled back. Nothing after it ran."
      fi
    done
    echo
    echo "done. Run 'npm run db:verify' to check the result."
    ;;

  verify)
    preflight
    "${PSQL[@]}" -f "$ROOT/supabase/verify.sql"
    ;;

  *)
    echo "usage: $0 [status|push|verify]" >&2; exit 1 ;;
esac
