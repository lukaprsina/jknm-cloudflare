import { bindings, defineConfig, defineWorker, triggers } from "cf/config";
import { createWorkersResponseStoreServiceBindingConfig } from "@vinext/cloudflare/cache/config";

const responseStore = await createWorkersResponseStoreServiceBindingConfig({
  worker: {
    name: "jknm-cloudflare-response-store",
    compatibilityDate: "2026-10-26",
    compatibilityFlags: ["nodejs_compat"],
  },
  bucket: "jknm-cloudflare-response-store-cache-bodies",
});

export const responseStoreServiceBinding = responseStore.serviceBindingWorker;

export default defineConfig({
  accountId: "a7295fea7e66c96cf8cbcb5be46dc874",
  worker: defineWorker({
    ...responseStore.applicationWorker,
    name: "jknm-cloudflare",
    entrypoint: "./worker/entry.ts",
    // Apex only; www redirects to it (a Redirect Rule, no Worker code).
    domains: ["jknm.org"],
    compatibilityDate: "2026-10-26",
    compatibilityFlags: ["nodejs_compat"],
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
    },
    triggers: [
      triggers.queue({ name: "jknm-search", maxBatchTimeout: 30 }),
      // Daily safety net for the search build and stale-content sweep.
      triggers.scheduled({ schedule: "0 3 * * *" }),
    ],
    env: {
      ...responseStore.applicationWorker.env,
      ASSETS: bindings.assets(),
      IMAGES: bindings.images(),
      MEDIA: bindings.r2({ name: "jknm-media" }),
      // Direct Supabase host of the new-shape database, caching disabled (checked with `cf hyperdrive get`).
      HYPERDRIVE: bindings.hyperdrive({ id: "a32e431c4a254188ab6580604760a966" }),
      QUEUE: bindings.queue({ name: "jknm-search" }),
      BETTER_AUTH_SECRET: bindings.secret(),
      GOOGLE_CLIENT_ID: bindings.secret(),
      GOOGLE_CLIENT_SECRET: bindings.secret(),
    },
  }),
});
