#!/usr/bin/env bash
# Spike helper: exports the local Hyperdrive connection string from DATABASE_URL in
# .env.local without printing it, then execs the given command.
set -euo pipefail
line=$(grep -m1 '^DATABASE_URL=' .env.local)
v=${line#DATABASE_URL=}; v=${v%\"}; v=${v#\"}
export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="$v"
export SPIKE_DATABASE_URL="$v"
exec "$@"
