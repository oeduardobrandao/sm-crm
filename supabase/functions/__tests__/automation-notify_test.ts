import { assertEquals } from "./assert.ts";
import { notifyAutomationFailure } from "../_shared/automation-notify.ts";

Deno.test("notifyAutomationFailure inclui extraMetadata no insert", async () => {
  const calls: Record<string, unknown>[] = [];
  const svc = {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ gt: () => ({ limit: () => ({ data: [], error: null }) }) }) }) }) }),
    }),
    rpc: (name: string, params: Record<string, unknown>) => {
      calls.push({ name, params });
      if (name === "resolve_notification_targets") return { data: ["u1"], error: null };
      return { data: null, error: null };
    },
  };

  await notifyAutomationFailure(svc as never, {
    contaId: "w1",
    clientId: 42,
    reason: "target_never_published",
    extraMetadata: { automation_id: "a1", automation_name: "Calendario Setembro" },
  });

  const insert = calls.find((c) => c.name === "insert_notification_batch")!;
  const meta = (insert.params as Record<string, Record<string, unknown>>).p_metadata;
  assertEquals(meta.reason, "target_never_published");
  assertEquals(meta.client_id, 42);
  assertEquals(meta.automation_id, "a1");
  assertEquals(meta.automation_name, "Calendario Setembro");
});
