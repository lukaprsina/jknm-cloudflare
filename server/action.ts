import { get_session } from "./auth/session";
import { create_action } from "./create-action";

/** `action(schema, handler)`: session gate, zod parse, business function, plain `ActionResult`. */
export const action = create_action(get_session);
