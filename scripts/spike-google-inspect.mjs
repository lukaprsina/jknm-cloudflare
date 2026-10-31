// Prints structure only (keys, types, masked email, PEM shape). Never prints key material.
import { readFileSync } from "node:fs";
const line = readFileSync(".env.local", "utf8")
  .split("\n")
  .find((l) => l.startsWith("JKNM_SERVICE_ACCOUNT_CREDENTIALS="));
let v = line
  .slice(line.indexOf("=") + 1)
  .trim()
  .replace(/^"|"$/g, "");
console.log("raw env value: length", v.length, "looks-base64:", /^[A-Za-z0-9+/=]+$/.test(v));
const json = JSON.parse(Buffer.from(v, "base64").toString("utf8"));
const mask = (e) => e.replace(/^(.{2}).*@/, "$1***@");
console.log("keys:", Object.keys(json).join(","));
console.log(
  "type:",
  json.type,
  "| client_email:",
  mask(json.client_email ?? ""),
  "| project_id len:",
  json.project_id?.length,
);
const pk = json.private_key;
console.log(
  "private_key: length",
  pk.length,
  "| header:",
  pk.split("\n")[0],
  "| real newlines:",
  (pk.match(/\n/g) || []).length,
  "| literal backslash-n:",
  (pk.match(/\\n/g) || []).length,
  "| ends with newline:",
  pk.endsWith("\n"),
);
const wl = readFileSync(".env.local", "utf8")
  .split("\n")
  .find((l) => l.startsWith("JKNM_WORKSPACE_ID="));
console.log(
  "JKNM_WORKSPACE_ID present:",
  !!wl,
  "len",
  wl ? wl.split("=")[1].replace(/"/g, "").length : 0,
);
