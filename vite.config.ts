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
  test: {
    exclude: [...configDefaults.exclude, ".references/**", ".cloudflare/**"],
  },
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
