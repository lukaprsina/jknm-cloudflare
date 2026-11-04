/** Google Workspace membership domain: the only domain admins sign in from. */
export const WORKSPACE_EMAIL_DOMAIN = "jknm.si";

/**
 * Hosts that may start a sign-in. `jknm.si` and `www.jknm.si` reach the Worker
 * through Cloudflare for SaaS at cutover; `jknm.org` is the apex we host on.
 */
export const APP_HOSTS = ["localhost:*", "jknm.org", "jknm.si", "www.jknm.si"];

/**
 * Where this deployment is reachable, set per environment (a build-time
 * literal, so it must exist in CI). Never inferred from the request.
 */
export function deployment_origin(): string {
  const origin = process.env.NEXT_PUBLIC_DEPLOYMENT_ORIGIN;
  if (!origin) throw new Error("NEXT_PUBLIC_DEPLOYMENT_ORIGIN is not set");
  return origin;
}

/** The absolute URL of a path on this deployment. */
export const page_url = (path: string) => `${deployment_origin()}${path}`;

/** The path of a news article under its slug. */
export const article_path = (slug: string) => `/novica/${encodeURIComponent(slug)}`;

/** The club's human-facing address, and the only domain admins sign in from. */
export const CONTACT_EMAIL = `info@${WORKSPACE_EMAIL_DOMAIN}`;
