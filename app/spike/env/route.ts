import { env } from "cloudflare:workers";

// Module-scope read (claim 1.3: allowed for vars/secrets)
const moduleScopeText = (env as unknown as Record<string, unknown>).SPIKE_TEXT;

export async function GET() {
  const e = env as unknown as Record<string, any>;
  const hd = e.HYPERDRIVE;
  let u: URL | null = null;
  try {
    u = new URL(hd.connectionString);
  } catch {}
  return Response.json({
    moduleScopeText,
    envKeys: Object.keys(e).sort(),
    processEnvKeys: Object.keys(process.env).sort(),
    processEnvSpikeText: process.env.SPIKE_TEXT,
    processEnvSecretLen: process.env.BETTER_AUTH_SECRET?.length ?? null,
    envSecretLen: e.BETTER_AUTH_SECRET?.length ?? null,
    processEnvDatabaseUrlPresent: "DATABASE_URL" in process.env,
    processEnvAwsPresent: "AWS_ACCESS_KEY_ID" in process.env,
    hyperdriveType: typeof hd,
    hyperdriveKeys: hd ? Object.keys(hd) : null,
    connShape: u && {
      protocol: u.protocol,
      port: u.port,
      hostIsLocalProxy: u.hostname,
      hasUser: !!u.username,
    },
    hdHost: hd?.host?.replace(/[a-z0-9]{20}/g, "<ref>"),
    hdPort: hd?.port,
    nodeEnv: process.env.NODE_ENV,
  });
}
