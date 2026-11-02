import { Result, TaggedError } from "better-result";
import { z } from "zod";
import type { Session } from "./auth/session-shape";

class Unauthorized extends TaggedError("Unauthorized")<{ message: string }> {}
class InvalidInput extends TaggedError("InvalidInput")<{
  message: string;
  fields: Record<string, string[]>;
}> {}
/** Anything unexpected: the session read or the handler threw. */
class Failed extends TaggedError("Failed")<{ message: string; cause: unknown }> {}

/**
 * What a Server Action returns. Plain data on purpose: `Result` instances do
 * not survive the Server Action boundary, and production Next redacts thrown
 * messages, so failures are returned, never thrown.
 */
export type ActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: {
        code: "unauthorized" | "invalid" | "failed";
        message: string;
        fields?: Record<string, string[]>;
      };
    };

const failed = (cause: unknown) => new Failed({ message: "Nekaj je šlo narobe.", cause });

const require_session = (session: Session | null) =>
  session
    ? Result.ok(session)
    : Result.err(new Unauthorized({ message: "Za to dejanje se morate prijaviti." }));

const parse = <S extends z.ZodType>(schema: S, raw: z.input<S>) => {
  const parsed = schema.safeParse(raw);
  return parsed.success
    ? Result.ok(parsed.data as z.output<S>)
    : Result.err(
        new InvalidInput({
          message: "Neveljaven vnos.",
          fields: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
        }),
      );
};

type Handler<S extends z.ZodType, T> = (input: z.output<S>, session: Session) => Promise<T> | T;

/**
 * Session gate, then zod parse, then the business function. Business
 * functions are tested directly, not through their actions. Deliberately
 * knows nothing about events or cache tags: lifecycle code emits domain
 * events (`create_articles({ db, emit })`), and wiring `emit` to the
 * invalidation policy belongs to the step that first needs it. Domain rule
 * violations become `code: "rule"` with step 6.
 */
export function create_action(read_session: () => Promise<Session | null>) {
  return <S extends z.ZodType, T>(schema: S, handler: Handler<S, T>) =>
    async (raw: z.input<S>): Promise<ActionResult<T>> => {
      const result = await Result.gen(async function* () {
        const maybe_session = yield* Result.await(
          Result.tryPromise({ try: read_session, catch: failed }),
        );
        const session = yield* require_session(maybe_session);
        const input = yield* parse(schema, raw);
        const data = yield* Result.await(
          Result.tryPromise({ try: async () => handler(input, session), catch: failed }),
        );
        return Result.ok(data);
      });

      return result.match({
        ok: (data): ActionResult<T> => ({ ok: true, data }),
        err: (error): ActionResult<T> => {
          if (error._tag === "Unauthorized") {
            return { ok: false, error: { code: "unauthorized", message: error.message } };
          }
          if (error._tag === "InvalidInput") {
            return {
              ok: false,
              error: { code: "invalid", message: error.message, fields: error.fields },
            };
          }
          console.error(error.cause);
          return { ok: false, error: { code: "failed", message: error.message } };
        },
      });
    };
}
