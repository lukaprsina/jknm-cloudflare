// Usage: scripts/spike-env.sh node scripts/spike-cache-test.mjs http://localhost:5199
import pg from "pg";
const base = process.argv[2];
const c = new pg.Client({ connectionString: process.env.SPIKE_DATABASE_URL });
await c.connect();
const dbCounter = async () =>
  (await c.query(`select counter from spike_hyperdrive_probe where label='cache'`)).rows[0].counter;
const html = await (await fetch(`${base}/spike/cache`)).text();
const ids = Object.fromEntries(
  [...html.matchAll(/name="\$ACTION_ID_([^"]+)"/g)].map((m) => [m[1].split("#")[1] ?? m[1], m[1]]),
);
const read = async () => await (await fetch(`${base}/spike/cache/read`)).json();
const page = async () =>
  JSON.parse(
    (await (await fetch(`${base}/spike/cache`)).text())
      .match(/<pre id="state">([^<]*)/)[1]
      .replaceAll("&quot;", '"'),
  );
const act = async (name) => {
  const r = await fetch(`${base}/spike/cache`, {
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
const show = async (label, extra = "") => {
  const r = await read();
  const p = await page();
  console.log(
    label.padEnd(34),
    "db=",
    await dbCounter(),
    "route.counter=",
    r.counter,
    "route.readAt=",
    r.readAt % 1e7,
    "page.counter=",
    p.counter,
    extra,
  );
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await show("baseline");
await show("baseline again (hit?)");
console.log("bumpNoInvalidate status", await act("bumpNoInvalidate"));
await show("after bump, no invalidation");
console.log("bumpUpdateTag status", await act("bumpUpdateTag"));
await show("after bump+updateTag");
await show("  again (should be cached)");
console.log("bumpRevalidateTag status", await act("bumpRevalidateTag"));
await show("after bump+revalidateTag(1 arg)");
console.log("bumpRevalidateTagMax status", await act("bumpRevalidateTagMax"));
await show("after bump+revalidateTag(max) #1");
await sleep(500);
await show("  #2");
await sleep(1500);
await show("  #3");
const o = async (fn) => await (await fetch(`${base}/spike/cache/outside?fn=${fn}`)).json();
console.log("outside updateTag:", JSON.stringify(await o("updateTag")));
await c.query(`update spike_hyperdrive_probe set counter=counter+1 where label='cache'`);
await show("direct DB write, no invalidation");
console.log("outside revalidateTag:", JSON.stringify(await o("revalidateTag")));
await show("after outside revalidateTag");
await c.query(`update spike_hyperdrive_probe set counter=counter+1 where label='cache'`);
console.log("outside revalidateTag max:", JSON.stringify(await o("revalidateTagMax")));
await show("after outside revalidateTag max #1");
await sleep(500);
await show("  #2");
await c.end();
