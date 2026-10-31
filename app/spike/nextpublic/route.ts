export const dynamic = "force-dynamic";
export async function GET() {
  const dyn = "NEXT_PUBLIC_SPIKE_MARK";
  return Response.json({
    static_literal: process.env.NEXT_PUBLIC_SPIKE_MARK ?? null,
    dynamic_key: (process.env as Record<string, string | undefined>)[dyn] ?? null,
    origin_literal: process.env.NEXT_PUBLIC_DEPLOYMENT_ORIGIN ?? null,
    publicKeysAtRuntime: Object.keys(process.env).filter((k) => k.startsWith("NEXT_PUBLIC_")),
  });
}
