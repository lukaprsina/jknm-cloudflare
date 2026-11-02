import type { DomainEvent } from "../lib/cache-policy";

/**
 * Called after a mutation commits, with what happened. Production wires cache
 * invalidation (and, later, the search build); tests pass a recorder. An error
 * here does not undo the committed change.
 */
export type Emit = (event: DomainEvent) => void | Promise<void>;

/**
 * An `Emit` that never throws. Events fire after the change has committed, so
 * a failing cache or search adapter must not make the caller lose the result;
 * the failure is logged instead.
 */
export function resilient(emit: Emit): Emit {
  return async (event) => {
    try {
      await emit(event);
    } catch (error) {
      console.error(`emit failed for ${event}`, error);
    }
  };
}
