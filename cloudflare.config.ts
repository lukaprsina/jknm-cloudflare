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
      // Placeholder id until `cf hyperdrive create` (direct host, caching disabled) is run.
      // Local dev uses CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE.
      HYPERDRIVE: bindings.hyperdrive({ id: "00000000000000000000000000000000" }),
      QUEUE: bindings.queue({ name: "jknm-search" }),
      BETTER_AUTH_SECRET: bindings.secret(),
    },
  }),
});
