// Scratch Worker for the Admin SDK probe. Deployed once, then deleted.
import { bindings, defineConfig, defineWorker } from "cf/config";

export default defineConfig({
  accountId: "a7295fea7e66c96cf8cbcb5be46dc874",
  worker: defineWorker({
    name: "spike-tmp-auth-google",
    entrypoint: "./worker.ts",
    compatibilityDate: "2026-10-26",
    compatibilityFlags: ["nodejs_compat"],
    observability: { enabled: true, headSamplingRate: 1 },
    env: {
      SPIKE_TOKEN: bindings.secret(),
      JKNM_SERVICE_ACCOUNT_CREDENTIALS: bindings.secret(),
      JKNM_WORKSPACE_ID: bindings.secret(),
    },
  }),
});
