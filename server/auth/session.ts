import { headers } from "next/headers";
import { get_auth } from "./index";
import { to_app_session, type Session } from "./session-shape";

/** The signed-in user for this request, or `null`. Read it in Server Components and actions. */
export async function get_session(): Promise<Session | null> {
  return to_app_session(await get_auth().api.getSession({ headers: await headers() }));
}
