// SPIKE: run the in-browser bench with CDP CPU (and optional network) throttling.
// node scripts/spike-search-cdp.mjs <cdp-ws-url> <page-url> <cpuRate> [kbps] [rttMs]
const [ws0, url, rate = "1", kbps = "0", rtt = "0"] = process.argv.slice(2);
const ws = new WebSocket(ws0);
let id = 0;
const pending = new Map();
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
  }
};
await new Promise((r) => (ws.onopen = r));
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Emulation.setCPUThrottlingRate", { rate: Number(rate) }, sessionId);
await send("Network.enable", {}, sessionId);
await send("Network.setCacheDisabled", { cacheDisabled: true }, sessionId);
if (Number(kbps) > 0)
  await send(
    "Network.emulateNetworkConditions",
    {
      offline: false,
      latency: Number(rtt),
      downloadThroughput: (Number(kbps) * 1000) / 8,
      uploadThroughput: (Number(kbps) * 1000) / 8,
    },
    sessionId,
  );
await send("Page.enable", {}, sessionId);
await send("Page.navigate", { url }, sessionId);
for (let i = 0; i < 120; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const r = await send(
    "Runtime.evaluate",
    { expression: "window.__spike ? JSON.stringify(window.__spike) : ''", returnByValue: true },
    sessionId,
  );
  if (r.result.value) {
    console.log(r.result.value);
    break;
  }
}
await send("Target.closeTarget", { targetId });
process.exit(0);
