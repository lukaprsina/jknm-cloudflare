// The ONLY module that imports "cloudflare:workers". Node tests / drizzle-kit never import it.
import { env, waitUntil } from "cloudflare:workers";

export function getHyperdriveConnectionString(): string {
  return (env as unknown as { HYPERDRIVE: { connectionString: string } }).HYPERDRIVE
    .connectionString;
}

export function getEnvString(name: string): string | undefined {
  const v = (env as unknown as Record<string, unknown>)[name];
  return typeof v === "string" ? v : undefined;
}

/** `waitUntil` from `cloudflare:workers` (changelog 2025-08-08); same semantics as ctx.waitUntil. */
export { waitUntil };
