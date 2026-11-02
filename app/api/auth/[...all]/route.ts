import { get_auth } from "@/server/auth";

// The Worker entry has already put the request's db in ALS.
export const GET = (request: Request) => get_auth().handler(request);
export const POST = (request: Request) => get_auth().handler(request);
