import handler from "vinext/server/fetch-handler";
import { runWithDb } from "@/server/db";
import { createPgDb } from "@/server/db/pg";
import { getServerEnv } from "@/server/env";
import { createInternalGate, INTERNAL_PREFIX } from "./internal-gate";

export * from "vinext/server/fetch-handler";

const gate = createInternalGate();

const scoped = <T>(fn: () => T) =>
  runWithDb(createPgDb(getServerEnv().HYPERDRIVE.connectionString), fn);

/**
 * `revalidateTag` from `next/cache` is a no-op in `queue`/`scheduled`, so
 * invalidation goes through the app's own internal route.
 */
export async function revalidateTags(tags: string[], env: Env, ctx: ExecutionContext) {
  const response = await handler.fetch(
    new Request(`http://internal${INTERNAL_PREFIX}revalidate`, {
      method: "POST",
      headers: { ...gate.headers, "content-type": "application/json" },
      body: JSON.stringify({ tags }),
    }),
    env,
    ctx,
  );
  if (!response.ok) throw new Error(`revalidate failed: ${response.status}`);
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (!gate.allows(request)) return new Response("Not found", { status: 404 });
    return scoped(() => handler.fetch(request, env, ctx));
  },

  // Stubs until the search build (step 7) and sweep job (step 8) land.
  async scheduled(_controller: ScheduledController, _env: Env, _ctx: ExecutionContext) {
    await scoped(async () => {});
  },

  async queue(batch: MessageBatch<unknown>, _env: Env, _ctx: ExecutionContext) {
    await scoped(async () => {
      batch.ackAll();
    });
  },
};
