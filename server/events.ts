import type { DomainEvent } from "../lib/cache-policy";

/**
 * Called after a mutation commits, with what happened. Production wires cache
 * invalidation (and, later, the search build); tests pass a recorder. An error
 * here does not undo the committed change.
 */
export type Emit = (event: DomainEvent) => void | Promise<void>;
