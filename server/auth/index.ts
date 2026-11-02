import { APP_HOSTS, deployment_origin } from "../../lib/domains";
import { db } from "../db";
import { get_server_env } from "../env";
import { create_auth, type Auth } from "./create-auth";

let instance: Auth | undefined;

/**
 * One `betterAuth()` per isolate. Construction never touches `db`; the ambient
 * proxy resolves the request's database on each call.
 */
export function get_auth(): Auth {
  if (instance) return instance;
  const env = get_server_env();
  const origin = deployment_origin();
  return (instance = create_auth({
    db,
    secret: env.BETTER_AUTH_SECRET,
    google: { client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET },
    allowed_hosts: APP_HOSTS,
    fallback_origin: origin,
    secure_cookies: origin.startsWith("https:"),
  }));
}
