// Usage: node scripts/spike-action-test.mjs http://localhost:5199
const base = process.argv[2];
const html = await (await fetch(`${base}/spike/cache`)).text();
// client component props carry the action references; find ids via flight payload in html
const ids = [...html.matchAll(/\$ACTION_ID_([^"]+)/g)].map((m) => m[1]);
console.log("form action ids", ids.length);
// extract resultAction / throwingAction ids from the RSC payload embedded in the html
const find = (name) =>
  html.match(new RegExp(String.raw`id\\*":\\*"([^"\\]+#` + name + String.raw`)\\*"`))?.[1] ??
  html.match(
    new RegExp(String.raw`id\\*":\\*"([^"\\]+)\\*",\\*"bound\\*":null,\\*"name\\*":\\*"` + name),
  )?.[1];
for (const [name, body] of [
  ["resultAction", "[2]"],
  ["resultAction", "[-1]"],
  ["throwingAction", "[]"],
]) {
  const id = find(name);
  if (!id) {
    console.log(name, "id not found in html");
    continue;
  }
  const r = await fetch(`${base}/spike/cache`, {
    method: "POST",
    headers: {
      "Next-Action": id,
      Accept: "text/x-component",
      "Content-Type": "text/plain;charset=UTF-8",
    },
    body,
  });
  const t = await r.text();
  console.log(
    name,
    body,
    "status",
    r.status,
    "content-type",
    r.headers.get("content-type"),
    "\n  body:",
    t.slice(0, 400).replace(/\n/g, "\\n"),
  );
}
