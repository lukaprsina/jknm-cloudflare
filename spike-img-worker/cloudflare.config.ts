import { bindings, defineConfig, defineWorker } from "cf/config";

// SPIKE (06): standalone image worker with Workers Cache enabled, to measure cf-cache-status on
// IMAGES-binding output. Scratch only; deleted after the run.
export default defineConfig({
  accountId: "a7295fea7e66c96cf8cbcb5be46dc874",
  worker: defineWorker({
    name: "spike-tmp-plumb-img",
    entrypoint: "./index.ts",
    compatibilityDate: "2026-10-26",
    cache: { enabled: true },
    env: {
      IMAGES: bindings.images(),
      IMG_BUCKET: bindings.r2({ name: "spike-tmp-plumb-img" }),
    },
  }),
});
