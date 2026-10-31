// Deployed cache test (06 worker plumbing). Usage: SPIKE_TOKEN=... node scripts/plumb-cache-test.mjs https://<worker>
// Truth = R2 object state/counter (read with `cf r2 objects get`), cached = unstable_cache entry tagged "plumb".
import { execFileSync } from "node:child_process";
const base = process.argv[2];
const bucket = process.argv[3] ?? "spike-tmp-plumb-img";
const H = { "x-spike-token": process.env.SPIKE_TOKEN };
const truth = () =>
  Number(
    execFileSync("cf", ["r2", "objects", "get", "state/counter", "--bucket-name", bucket], {
      encoding: "utf8",
    }).trim(),
  );
const get = (p, init = {}) => fetch(base + p, { ...init, headers: { ...H, ...init.headers } });
const hdr = (r) =>
  `cf-cache-status=${r.headers.get("cf-cache-status")} x-vinext-cache=${r.headers.get("x-vinext-cache")} age=${r.headers.get("age")} ray=${r.headers.get("cf-ray")?.split("-")[1]}`;
const route = async () => {
  const r = await get("/spike/plumb/read");
  return { ...(await r.json()), h: hdr(r) };
};
const state = async (path) => {
  const r = await get(path);
  const t = await r.text();
  return {
    ...JSON.parse(t.match(/<pre id="state">([^<]*)/)[1].replaceAll("&quot;", '"')),
    h: hdr(r),
  };
};
const html = await (await get("/spike/plumb")).text();
const ids = Object.fromEntries(
  [...html.matchAll(/name="\$ACTION_ID_([^"]+)"/g)].map((m) => [m[1].split("#")[1] ?? m[1], m[1]]),
);
const act = async (name) => {
  const r = await get("/spike/plumb", {
    method: "POST",
    headers: {
      "Next-Action": ids[name],
      Accept: "text/x-component",
      "Content-Type": "text/plain;charset=UTF-8",
    },
    body: "[]",
  });
  await r.text();
  return r.status;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const show = async (label) => {
  const t = truth();
  const r = await route();
  const p = await state("/spike/plumb");
  const i = await state("/spike/isr");
  console.log(
    label.padEnd(30),
    `truth=${t} route=${r.counter}${r.counter === t ? " " : "!"} page=${p.counter}${p.counter === t ? " " : "!"} isr=${i.counter}${i.counter === t ? " " : "!"} isrRenderedAt=${i.renderedAt % 1e6} | route:${r.h} | isr:${i.h}`,
  );
};
console.log("action ids", Object.keys(ids).join(","));
await show("baseline");
await show("baseline again");
console.log("bumpNoInvalidate", await act("bumpNoInvalidate"));
await show("after bump, no invalidation");
console.log("bumpUpdateTag", await act("bumpUpdateTag"));
await show("after bump+updateTag");
await show("  again");
console.log("bumpRevalidateTag(expire0)", await act("bumpRevalidateTag"));
await show("after bump+revalidateTag");
console.log("bumpRevalidateTagMax", await act("bumpRevalidateTagMax"));
for (const ms of [0, 300, 1000, 3000, 6000]) {
  await sleep(ms);
  await show(`  max after +${ms}ms more`);
}
// staleness window: hammer reads right after updateTag
console.log("--- rapid reads after updateTag");
await act("bumpUpdateTag");
const t = truth();
const seen = [];
for (let i = 0; i < 12; i++) {
  const r = await route();
  seen.push(`${r.counter === t ? "F" : "S"}`);
}
console.log("route reads (F=fresh,S=stale):", seen.join(""));
