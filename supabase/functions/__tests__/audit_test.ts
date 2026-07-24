// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals } from "./assert.ts";
import { insertAuditLog } from "../_shared/audit.ts";

/** Swap console.error for the duration of `fn`, returning what it captured. */
async function captureErrors(fn: () => Promise<void>): Promise<unknown[][]> {
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };
  try {
    await fn();
  } finally {
    console.error = original;
  }
  return logged;
}

const ENTRY = { action: "admin-create-invite", resource_type: "invite" };

Deno.test("insertAuditLog logs a RETURNED { error } (supabase-js resolves, never throws)", async () => {
  const svc: any = { from: () => ({ insert: () => Promise.resolve({ error: { message: "boom" } }) }) };
  const logged = await captureErrors(() => insertAuditLog(svc, ENTRY));
  assertEquals(logged.length, 1);
  assert(String(logged[0][0]).includes("[audit]"), "expected the [audit] prefix");
});

Deno.test("insertAuditLog still swallows a THROWN error", async () => {
  const svc: any = { from: () => ({ insert: () => Promise.reject(new Error("network")) }) };
  const logged = await captureErrors(() => insertAuditLog(svc, ENTRY));
  assertEquals(logged.length, 1);
});

Deno.test("insertAuditLog is silent on success", async () => {
  const svc: any = { from: () => ({ insert: () => Promise.resolve({ error: null }) }) };
  const logged = await captureErrors(() => insertAuditLog(svc, ENTRY));
  assertEquals(logged.length, 0);
});
