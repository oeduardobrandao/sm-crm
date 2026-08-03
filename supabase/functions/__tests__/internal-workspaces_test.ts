import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { fetchInternalWorkspaceIds } from "../_shared/internal-workspaces.ts";

function svcReturning(result: { data?: unknown; error?: unknown }) {
  const calls: Array<{ table: string; column: string; value: unknown }> = [];
  const svc = {
    from(table: string) {
      return {
        select(_cols: string) {
          return {
            eq(column: string, value: unknown) {
              calls.push({ table, column, value });
              return Promise.resolve(result);
            },
          };
        },
      };
    },
  };
  return { svc, calls };
}

Deno.test("returns the flagged workspace ids", async () => {
  const { svc, calls } = svcReturning({ data: [{ id: "ws-a" }, { id: "ws-b" }] });

  const ids = await fetchInternalWorkspaceIds(svc);

  assertEquals([...ids].sort(), ["ws-a", "ws-b"]);
  assertEquals(calls, [{ table: "workspaces", column: "is_internal", value: true }]);
});

Deno.test("no flagged workspaces yields an empty set", async () => {
  const { svc } = svcReturning({ data: [] });
  assertEquals((await fetchInternalWorkspaceIds(svc)).size, 0);
});

Deno.test("fails OPEN when the lookup errors", async () => {
  // A closed default would skip real customers whenever this small query hiccups,
  // which is strictly worse than one wasted sync of a test account.
  const { svc } = svcReturning({ error: { message: "connection reset" } });
  assertEquals((await fetchInternalWorkspaceIds(svc)).size, 0);
});

Deno.test("fails OPEN when the client throws", async () => {
  const svc = {
    from() {
      throw new Error("boom");
    },
  };
  assertEquals((await fetchInternalWorkspaceIds(svc)).size, 0);
});
