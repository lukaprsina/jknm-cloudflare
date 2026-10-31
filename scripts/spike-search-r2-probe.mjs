// node cdp.mjs <cdp-ws-url> <page-url> [cacheDisabled=1]
// Loads page, calls window.run(), prints page result + CDP network facts for the artifact request.
const [ws0, url, cd = "1"] = process.argv.slice(2);
const ws = new WebSocket(ws0);
let id = 0;
const pending = new Map();
const ev = [];
const send = (method, params = {}, sessionId) =>
  new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  });
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    const p = pending.get(d.id);
    pending.delete(d.id);
    if (d.error) p.rej(new Error(JSON.stringify(d.error)));
    else p.res(d.result);
  } else if (d.method) ev.push(d);
};
await new Promise((r) => (ws.onopen = r));
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Network.enable", {}, sessionId);
await send("Network.setCacheDisabled", { cacheDisabled: cd === "1" }, sessionId);
await send("Page.enable", {}, sessionId);
await send("Page.navigate", { url }, sessionId);
await new Promise((r) => setTimeout(r, 1500));
const r = await send(
  "Runtime.evaluate",
  { expression: "window.run()", awaitPromise: true, returnByValue: true },
  sessionId,
);
console.log("page:", r.result.value ?? JSON.stringify(r));
const reqs = new Map();
for (const e of ev) {
  const p = e.params;
  if (e.method === "Network.responseReceived" && p.response.url.includes("spike-tmp-search")) {
    const h = p.response.headers;
    reqs.set(p.requestId, {
      status: p.response.status,
      ce: h["content-encoding"],
      cl: h["content-length"],
      cfc: h["cf-cache-status"],
      acao: h["access-control-allow-origin"],
      fromDisk: p.response.fromDiskCache,
      protocol: p.response.protocol,
    });
  }
  if (e.method === "Network.loadingFinished" && reqs.has(p.requestId))
    reqs.get(p.requestId).encodedDataLength = p.encodedDataLength;
  if (e.method === "Network.loadingFailed")
    console.log("FAILED", p.errorText, p.corsErrorStatus?.corsError ?? "");
}
console.log("net:", JSON.stringify([...reqs.values()]));
await send("Target.closeTarget", { targetId });
process.exit(0);
