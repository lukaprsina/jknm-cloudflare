#!/usr/bin/env bash
# usage: cpu.sh FROM_ISO TO_ISO  -> one line per invocation
mkdir -p /tmp/spike-search-paid && cd /tmp/spike-search-paid
F=$(date -d "$1" +%s%3N); T=$(date -d "$2" +%s%3N)
cat > body.json <<J
{"queryId":"spike-tmp-q$RANDOM","view":"events","limit":100,"timeframe":{"from":$F,"to":$T},"parameters":{"filters":[{"key":"\$metadata.service","operation":"eq","type":"string","value":"spike-tmp-search-app"}],"calculations":[],"orderBy":{"value":"timestamp","order":"asc"}}}
J
cf o11y telemetry query --body "$(cat body.json)" > cpu-raw.json 2>&1
node -e '
const j=JSON.parse(require("fs").readFileSync("cpu-raw.json","utf8"));
const ev=j.events?.events??j.result?.events?.events??[];
for(const e of ev){const w=e.$workers??{};console.log(new Date(e.timestamp).toISOString(), w.event?.request?.path??"", w.cpuTimeMs, w.wallTimeMs, w.outcome)}
console.log("n=",ev.length)
'
