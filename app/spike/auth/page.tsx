import { headers } from "next/headers";
import { getAuth } from "@/lib/spike/auth/instances";
import { to_app_session } from "@/lib/spike/auth/session-shape";

export const dynamic = "force-dynamic";

// Server Component path: same call shape as the old getServerAuthSession.
export default async function Page() {
  const session = to_app_session(await getAuth().api.getSession({ headers: await headers() }));
  return (
    <main>
      <pre id="session">{JSON.stringify(session)}</pre>
    </main>
  );
}
