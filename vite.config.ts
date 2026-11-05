import { configDefaults, defineConfig, lazyPlugins } from "vite-plus";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import { responseStoreServiceBinding } from "./cloudflare.config";
import { responseStoreAdapter } from "@vinext/cloudflare/cache/response-store-adapter";
import { imagesOptimizer } from "@vinext/cloudflare/images/images-optimizer";

// Vitest sets VITEST. The framework build owns JSX and `@/` resolution, so these are test-only.
const under_test = Boolean(process.env.VITEST);

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
    overrides: [
      {
        // ADR-0001: a session read makes a render dynamic and uncacheable. This is the fast
        // per-file signal; app/public-routes.test.ts checks the whole import graph.
        files: ["app/(site)/**", "components/shell/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              paths: [
                {
                  name: "@/server/auth/session",
                  message: "Public routes are session-free (ADR-0001).",
                },
                { name: "next/headers", message: "Public routes are session-free (ADR-0001)." },
              ],
            },
          ],
        },
      },
    ],
  },
  test: {
    exclude: [...configDefaults.exclude, ".references/**", ".cloudflare/**", "docs/private/**"],
  },
  // Component tests import through the tsconfig `@/*` paths and need JSX compiled
  // (tsconfig keeps it as `preserve` for the framework build).
  resolve: under_test ? { tsconfigPaths: true } : undefined,
  oxc: under_test ? { jsx: { runtime: "automatic" } } : undefined,
  // vinext/Cloudflare plugins need workerd; unit tests run in plain Node.
  plugins: lazyPlugins(() =>
    under_test
      ? []
      : [
          vinext({
            cache: responseStoreAdapter(),
            images: { optimizer: imagesOptimizer() },
          }),
          cloudflare({
            auxiliaryWorkers: [{ config: responseStoreServiceBinding }],
            viteEnvironment: {
              name: "rsc",
              childEnvironments: ["ssr"],
            },
          }),
        ],
  ),
});
