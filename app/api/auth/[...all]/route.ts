import { getAuth } from "@/lib/spike/auth/instances";

// Replaces `toNextJsHandler(auth)` (module-scope auth). The Worker entry has already put the
// request db in ALS, so the isolate-wide auth resolves it lazily.
export const GET = (req: Request) => getAuth().handler(req);
export const POST = (req: Request) => getAuth().handler(req);
