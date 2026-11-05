/** Shared by the e2e suites. They run only when `E2E_URL` names a deployed or previewed Worker. */
export const base = process.env.E2E_URL ?? "";
/** Cases that need `scripts/seed-smoke.ts` data; set for a seeded preview only. */
export const seeded = process.env.SEEDED === "1";

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
