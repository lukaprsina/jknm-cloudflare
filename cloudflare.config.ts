import { bindings, defineConfig, defineWorker, triggers } from "cf/config";
import { createWorkersResponseStoreServiceBindingConfig } from "@vinext/cloudflare/cache/config";

// PLUMB=1 -> scratch resources (spike-tmp-plumb-*), never the real Worker names.
const P = process.env.PLUMB ? "spike-tmp-plumb-" : "";
const responseStore = await createWorkersResponseStoreServiceBindingConfig({
  worker: {
    name: P ? `${P}rs` : "jknm-cloudflare-response-store",
    compatibilityDate: "2026-10-26",
    compatibilityFlags: ["nodejs_compat"],
  },
  bucket: P ? `${P}rs-bodies` : "jknm-cloudflare-response-store-cache-bodies",
});

export const responseStoreServiceBinding = responseStore.serviceBindingWorker;

export default defineConfig({
  accountId: "a7295fea7e66c96cf8cbcb5be46dc874",
  worker: defineWorker({
    ...responseStore.applicationWorker,
    name: P ? `${P}app` : "jknm-cloudflare",
    entrypoint: "./lib/spike/worker-entry.ts",
    compatibilityDate: "2026-10-26",
    compatibilityFlags: ["nodejs_compat"],
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
    },
    triggers: P
      ? [
          triggers.queue({ name: `${P}q`, maxBatchTimeout: 1 }),
          triggers.scheduled({ schedule: "* * * * *" }),
        ]
      : [],
    env: {
      ...responseStore.applicationWorker.env,
      ASSETS: bindings.assets(),
      IMAGES: bindings.images(),
      // SPIKE (spike/db-cache): placeholder id, never deployed. Local dev uses
      // CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE.
      HYPERDRIVE: bindings.hyperdrive({
        id: process.env.PLUMB_HD ?? "00000000000000000000000000000000",
      }),
      QUEUE: bindings.queue({ name: `${P}q` }),
      IMG_BUCKET: bindings.r2({ name: `${P}img` }),
      SPIKE_TEXT: bindings.text("spike-text-value"),
      BETTER_AUTH_SECRET: bindings.secret(),
      SPIKE_TOKEN: bindings.secret(),
    },
  }),
});
