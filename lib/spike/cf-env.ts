// The ONLY module that imports "cloudflare:workers". Node tests / drizzle-kit never import it.
import { env } from "cloudflare:workers";

export function getHyperdriveConnectionString(): string {
  return (env as unknown as { HYPERDRIVE: { connectionString: string } }).HYPERDRIVE
    .connectionString;
}
