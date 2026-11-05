/** Shared by the e2e suites. They run only when `E2E_URL` names a deployed or previewed Worker. */
export const base = (process.env.E2E_URL ?? "").replace(/\/$/, "");
/** Cases that need `scripts/seed-smoke.ts` data; set for a seeded preview only. */
export const seeded = process.env.SEEDED === "1";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function get(path: string, origin = base) {
  const res = await fetch(origin + path, { redirect: "manual" });
  return {
    body: await res.text(),
    status: res.status,
    location: res.headers.get("location"),
    cache: res.headers.get("x-vinext-cache"),
    cache_control: res.headers.get("cache-control"),
  };
}

/** The response store writes asynchronously: poll until the page is served from it. */
export async function until_hit(path: string) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const res = await get(path);
    if (res.cache === "HIT") return res;
    await sleep(1000);
  }
  return get(path);
}

/** Junk must never be stored: still no `HIT` after the window in which `until_hit` would see one. */
export async function never_hit(path: string) {
  for (let attempt = 0; attempt < 10; attempt++) {
    if ((await get(path)).cache === "HIT") return false;
    await sleep(1000);
  }
  return true;
}
