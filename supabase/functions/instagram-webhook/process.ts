// supabase/functions/instagram-webhook/process.ts
// Stub: Task 9 replaces this with the real comment-to-DM processor. Exists only so index.ts
// compiles and has a default `processDelivery` to wire up; the handler test injects its own
// `processDelivery`, so it never depends on this stub's behavior.
import type { EventRow } from "./handler.ts";

type DbClient = {
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
};

// deno-lint-ignore no-unused-vars
export const createProcessDelivery = (deps: Record<string, never>) =>
async (_svc: DbClient, _rows: EventRow[]): Promise<void> => {};
