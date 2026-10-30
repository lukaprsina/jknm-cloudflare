#!/usr/bin/env bash
# Usage: scripts/spike-env.sh scripts/spike-sched-test.sh http://localhost:5199
B=${1:-http://localhost:5199}
r() { curl -s "$B/spike/cache/read"; echo; }
bump() { node -e 'const pg=require("pg");(async()=>{const c=new pg.Client({connectionString:process.env.SPIKE_DATABASE_URL});await c.connect();await c.query("update spike_hyperdrive_probe set counter=counter+100 where label=$1",["cache"]);await c.end()})()'; }
for mode in direct handler; do
  echo "== scheduled cron=$mode"; r; bump; r
  curl -s "$B/cdn-cgi/local/scheduled?cron=$mode" -o /dev/null; sleep 2; r
done
