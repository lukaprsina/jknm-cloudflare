import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { SignJWT, decodeJwt } from "jose";
import { createSearchParamsCache, parseAsInteger, parseAsString } from "nuqs/server";
import { z } from "zod";
import { create, insert, search } from "zbsearch";
import { persist, restore } from "@zbsearch/plugin-data-persistence";
import { language, stemmer } from "@zbsearch/stemmers/slovenian";
import { db } from "@/lib/spike/db";
import { probe } from "@/lib/spike/schema";
import { ClientBits } from "./client-bits";

// SPIKE (06 item 3): the real server-side dependency set, actually exercised at request time so
// bundlers cannot drop it. Client-only libs (react-hook-form, motion, cmdk, editorjs) live in
// ./client-bits and the editor route.
export const dynamic = "force-dynamic";

const cache = createSearchParamsCache({ q: parseAsString.withDefault("jama"), n: parseAsInteger });

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const sp = cache.parse(await searchParams);
  const auth = betterAuth({
    baseURL: { allowedHosts: ["localhost:3000"] },
    secret: "x".repeat(32),
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { user: probe, session: probe, account: probe, verification: probe },
    }),
    socialProviders: { google: { clientId: "id", clientSecret: "secret" } },
  });
  const jwt = await new SignJWT({ a: 1 })
    .setProtectedHeader({ alg: "HS256" })
    .sign(new TextEncoder().encode("k".repeat(32)));
  const t0 = performance.now();
  const idx = create({
    schema: { title: "string", body: "string" } as const,
    components: { tokenizer: { stemming: true, stemmer, language } },
  });
  for (let i = 0; i < 200; i++)
    await insert(idx, {
      title: `Jama ${i}`,
      body: `Jame so lepe, jamarji raziskujejo jamo številka ${i}`,
    });
  const hits = await search(idx, { term: sp.q, limit: 5 });
  const blob = await persist(idx, "binary");
  const restored = await restore("binary", blob);
  const parsed = z.object({ n: z.number() }).safeParse({ n: 1 });
  return (
    <main>
      <pre>
        {JSON.stringify({
          authKeys: Object.keys(auth).length,
          jwtLen: jwt.length,
          decoded: decodeJwt(jwt).a,
          hits: hits.count,
          searchMs: Math.round(performance.now() - t0),
          persistType: typeof blob,
          restoredOk: !!restored,
          zod: parsed.success,
          q: sp.q,
        })}
      </pre>
      <ClientBits />
    </main>
  );
}
