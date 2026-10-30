import { Suspense } from "react";
import { sql } from "drizzle-orm";
import { db } from "@/lib/spike/db";

export const dynamic = "force-dynamic";

async function Slow() {
  await new Promise((r) => setTimeout(r, 1500));
  const r = (await db.execute(
    sql`select count(*)::int as n from spike_hyperdrive_probe`,
  )) as unknown as { rows: { n: number }[] };
  return <p id="slow">rows={r.rows[0]!.n}</p>;
}

export default function Page() {
  return (
    <Suspense fallback={<p>loading</p>}>
      <Slow />
    </Suspense>
  );
}
