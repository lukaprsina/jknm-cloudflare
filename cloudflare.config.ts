import { bindings, defineConfig, defineWorker } from "cf/config";
import { createWorkersResponseStoreServiceBindingConfig } from "@vinext/cloudflare/cache/config";

// SPIKE (spike/search-local): SPIKE_SEARCH=1 swaps every resource name for a scratch one so a
// deploy can never touch the real `jknm-cloudflare` Workers. Without it the config is unchanged.
const SPIKE = process.env.SPIKE_SEARCH === "1";
const NAME = SPIKE ? "jknm-spike-search-app" : "jknm-cloudflare";
const RS_NAME = SPIKE ? "jknm-spike-search-response-store" : "jknm-cloudflare-response-store";
const RS_BUCKET = SPIKE
  ? "jknm-spike-search-response-store-bodies"
  : "jknm-cloudflare-response-store-cache-bodies";

const responseStore = await createWorkersResponseStoreServiceBindingConfig({
  worker: {
    name: RS_NAME,
    compatibilityDate: "2026-10-26",
    compatibilityFlags: ["nodejs_compat"],
  },
  bucket: RS_BUCKET,
});

export const responseStoreServiceBinding = responseStore.serviceBindingWorker;

export default defineConfig({
  accountId: "a7295fea7e66c96cf8cbcb5be46dc874",
  worker: defineWorker({
    ...responseStore.applicationWorker,
    name: NAME,
    entrypoint: SPIKE ? "./lib/spike-search/worker-entry.ts" : "vinext/server/fetch-handler",
    compatibilityDate: "2026-10-26",
    compatibilityFlags: ["nodejs_compat"],
    observability: { enabled: true },
    // Free plan rejects any `limits`; set SPIKE_CPU_MS only on a Workers Paid account.
    ...(process.env.SPIKE_CPU_MS ? { limits: { cpuMs: Number(process.env.SPIKE_CPU_MS) } } : {}),
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
    },
    env: {
      ...responseStore.applicationWorker.env,
      ASSETS: bindings.assets(),
      IMAGES: bindings.images(),
      // SPIKE (spike/search-local)
      SEARCH_R2: bindings.r2({ name: "jknm-spike-search-artifacts" }),
      SPIKE_TOKEN: bindings.secret(),
    },
  }),
});
