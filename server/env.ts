import { env } from "cloudflare:workers";
import { z } from "zod";

/**
 * Runtime env: only bindings declared in `cloudflare.config.ts` exist here
 * (`DATABASE_URL` is for drizzle-kit and never reaches the Worker). The only
 * importer of `cloudflare:workers`. Validated lazily on first use, never at
 * import. `NEXT_PUBLIC_*` are build-time literals and are not read from here.
 */
const binding = <T>() => z.custom<T>((value) => typeof value === "object" && value !== null);

const schema = z.object({
  HYPERDRIVE: z.object({ connectionString: z.string().min(1) }),
  MEDIA: binding<R2Bucket>(),
  IMAGES: binding<ImagesBinding>(),
  BETTER_AUTH_SECRET: z.string().min(32),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | undefined;
export const get_server_env = (): ServerEnv => (cached ??= schema.parse(env));
