import { configDefaults, defineConfig, lazyPlugins } from "vite-plus";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import { responseStoreServiceBinding } from "./cloudflare.config";
import { responseStoreAdapter } from "@vinext/cloudflare/cache/response-store-adapter";
import { imagesOptimizer } from "@vinext/cloudflare/images/images-optimizer";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  // The `@/` alias of tsconfig, which component tests import through.
  resolve: process.env.VITEST ? { alias: { "@": import.meta.dirname } } : undefined,
  test: {
    exclude: [...configDefaults.exclude, ".references/**", ".cloudflare/**"],
  },
  // tsconfig keeps JSX as `preserve` for the framework build; component tests need it compiled.
  oxc: process.env.VITEST ? { jsx: { runtime: "automatic" } } : undefined,
  // vinext/Cloudflare plugins need workerd; unit tests run in plain Node.
  plugins: lazyPlugins(() =>
    process.env.VITEST
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
