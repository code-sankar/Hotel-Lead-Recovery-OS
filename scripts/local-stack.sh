#!/usr/bin/env bash
#
# Brings up a local PostgreSQL + PostgREST that speak the same dialect as
# Supabase, applies every migration, and prints the URL the integration suite
# wants. Used to exercise the PostgREST layer — the embeds, the filters and the
# RPC argument names — which unit tests against an in-memory store cannot reach.
#
#   ./scripts/local-stack.sh up
#   LEADSTAY_PGRST_URL=http://127.0.0.1:55433 npm run test:integration
#   ./scripts/local-stack.sh down
#
# Requires: postgresql-16 (server binaries) and a `postgrest` binary on PATH or
# at ./.local/postgrest. Neither is a project dependency.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${LEADSTAY_STACK_DIR:-/var/tmp/leadstay-stack}"
PGPORT="${LEADSTAY_PG_PORT:-55432}"
PGRST_PORT="${LEADSTAY_PGRST_PORT:-55433}"
PGBIN="${LEADSTAY_PG_BIN:-/usr/lib/postgresql/16/bin}"
PGRST_BIN="$(command -v postgrest || echo "$ROOT/.local/postgrest")"
JWT_SECRET="${LEADSTAY_JWT_SECRET:-super-secret-jwt-token-with-at-least-32-characters-long}"
PSQL="psql -h 127.0.0.1 -p $PGPORT -U postgres -q -v ON_ERROR_STOP=1"

start_postgres() {
  if [ ! -d "$WORK/pgdata" ]; then
    mkdir -p "$WORK/pgdata"
    chown -R postgres:postgres "$WORK"
    chmod 700 "$WORK/pgdata"
    su postgres -c "$PGBIN/initdb -D $WORK/pgdata -U postgres --auth=trust" > "$WORK/initdb.log" 2>&1
  fi
  su postgres -c "$PGBIN/pg_ctl -D $WORK/pgdata -l $WORK/pg.log -o '-p $PGPORT -k /var/tmp -c listen_addresses=127.0.0.1' start" \
    > /dev/null 2>&1 || true
  for _ in $(seq 1 20); do
    $PSQL -d postgres -c 'select 1' > /dev/null 2>&1 && return 0
    sleep 1
  done
  echo "postgres did not start; see $WORK/pg.log" >&2; exit 1
}

apply_schema() {
  $PSQL -d postgres -c "drop database if exists leadstay with (force);" -c "create database leadstay;"
  $PSQL -d leadstay -f "$ROOT/supabase/local/supabase-shim.sql"
  for f in "$ROOT"/supabase/migrations/*.sql; do
    $PSQL -d leadstay -f "$f" > /dev/null
  done
  # Users the integration suite signs in as.
  $PSQL -d leadstay -c "
    insert into auth.users (id, email) values
      ('11111111-1111-4111-8111-111111111111','owner-a@example.com'),
      ('33333333-3333-4333-8333-333333333333','staff-a@example.com'),
      ('99999999-9999-4999-8999-999999999999','stranger@example.com')
    on conflict do nothing;
    grant usage on schema public to anon, authenticated, service_role;"
  echo "schema applied"
}

start_postgrest() {
  [ -x "$PGRST_BIN" ] || { echo "postgrest not found (looked at $PGRST_BIN)" >&2; exit 1; }
  cat > "$WORK/postgrest.conf" <<CONF
db-uri = "postgres://authenticator:authpass@127.0.0.1:$PGPORT/leadstay"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$JWT_SECRET"
server-port = $PGRST_PORT
db-pool = 4
CONF
  [ -f "$WORK/pgrst.pid" ] && kill "$(cat "$WORK/pgrst.pid")" 2>/dev/null || true
  sleep 1
  setsid "$PGRST_BIN" "$WORK/postgrest.conf" > "$WORK/postgrest.log" 2>&1 &
  echo $! > "$WORK/pgrst.pid"
  for _ in $(seq 1 20); do
    sleep 1
    if [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PGRST_PORT/")" = "200" ]; then
      echo "postgrest up on http://127.0.0.1:$PGRST_PORT"
      return 0
    fi
  done
  echo "postgrest did not start; see $WORK/postgrest.log" >&2; exit 1
}

case "${1:-up}" in
  up)
    mkdir -p "$WORK"
    start_postgres
    apply_schema
    start_postgrest
    echo
    echo "LEADSTAY_PGRST_URL=http://127.0.0.1:$PGRST_PORT npm run test:integration"
    ;;
  down)
    [ -f "$WORK/pgrst.pid" ] && kill "$(cat "$WORK/pgrst.pid")" 2>/dev/null || true
    su postgres -c "$PGBIN/pg_ctl -D $WORK/pgdata stop" > /dev/null 2>&1 || true
    echo "stopped"
    ;;
  *)
    echo "usage: $0 [up|down]" >&2; exit 1 ;;
esac
