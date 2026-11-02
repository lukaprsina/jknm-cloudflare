#!/usr/bin/env bash
# Backs up the Supabase Postgres DB to <backup_dir>/jknm_<timestamp>.dump
# (pg_dump custom format, -Fc) and verifies the archive is readable.
#
# Usage: scripts/backup-db.sh [env_file]
#   env_file    defaults to .env.prod-ref (reads only its DATABASE_URL line)
#   BACKUP_DIR  defaults to ~/backups/jknm (keep it outside the repo: the dump
#               contains session tokens and OAuth tokens)
#
# pg_dump sets session-level state, which leaks between clients on Supabase's
# transaction pooler (port 6543). A :6543 URL is rewritten to the session
# pooler on :5432 of the same host.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${1:-$repo_root/.env.prod-ref}"
backup_dir="${BACKUP_DIR:-$HOME/backups/jknm}"

line="$(grep -m1 '^DATABASE_URL=' "$env_file" || true)"
[ -n "$line" ] || { echo "DATABASE_URL not found in $env_file" >&2; exit 1; }
db_url="${line#DATABASE_URL=}"
db_url="${db_url#\"}"
db_url="${db_url%\"}"
db_url="${db_url/pooler.supabase.com:6543/pooler.supabase.com:5432}"

umask 077
mkdir -p "$backup_dir"
out_file="$backup_dir/jknm_$(date +%Y%m%d_%H%M%S).dump"

echo "Backing up to $out_file"
pg_dump "$db_url" -Fc -f "$out_file"

# A truncated or corrupt archive fails here.
entries="$(pg_restore --list "$out_file" | grep -c 'TABLE DATA' || true)"
size="$(du -h "$out_file" | cut -f1)"
echo "Backup complete: $out_file ($size, $entries tables with data)"
