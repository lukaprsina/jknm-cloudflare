#!/usr/bin/env bash
# Replaces the local dev database (the `jknm-sandbox` Postgres container, db `jknm_dev`)
# with a copy of the public schema of the remote database.
# Usage: SOURCE_DB_URL='postgresql://postgres.<ref>:<password>@aws-1-eu-central-1.pooler.supabase.com:5432/postgres' scripts/seed-local-db.sh
# Use the session pooler string: the direct Supabase host is IPv6-only. Treat the data like a secret.
set -euo pipefail
: "${SOURCE_DB_URL:?set SOURCE_DB_URL to the remote connection string}"
container=jknm-sandbox

docker exec "$container" psql -U postgres -d postgres -c 'drop database if exists jknm_dev' -c 'create database jknm_dev'
docker exec -e SOURCE_DB_URL="$SOURCE_DB_URL" "$container" sh -c \
  'pg_dump "$SOURCE_DB_URL" -n public -Fc --no-owner --no-acl | pg_restore -U postgres -d jknm_dev --clean --if-exists --no-owner --no-acl --exit-on-error'
docker exec "$container" psql -U postgres -d jknm_dev -Atc "select count(*) || ' articles' from articles"
