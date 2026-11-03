import { assert, assertEquals } from "./assert.ts";
import { disconnectAccount } from "../instagram-integration/disconnect.ts";

type Call = { table: string; op: string; payload?: unknown; col?: string; val?: unknown };

function fakeSvc(failTable?: string) {
  const calls: Call[] = [];
  const svc = {
    from(table: string) {
      const make = (op: string, payload?: unknown) => ({
        eq(col: string, val: unknown) {
          calls.push({ table, op, payload, col, val });
          return Promise.resolve({ error: table === failTable ? { message: "boom" } : null });
        },
      });
      return {
        delete: () => make("delete"),
        update: (p: unknown) => make("update", p),
      };
    },
  };
  return { svc, calls };
}

Deno.test("disconnect apaga posts e análises antes de zerar o token", async () => {
  const { svc, calls } = fakeSvc();
  await disconnectAccount(svc, "acc-1");
  assertEquals(
    calls.map((c) => `${c.op}:${c.table}`),
    ["delete:instagram_posts", "delete:instagram_comment_analyses", "update:instagram_accounts"],
  );
  assertEquals(calls[0].col, "instagram_account_id");
  assertEquals(calls[1].col, "instagram_account_id");
  assertEquals(calls[1].val, "acc-1");
  assertEquals(calls[2].col, "id");
  const p = calls[2].payload as Record<string, unknown>;
  assertEquals(p.encrypted_access_token, "");
  assertEquals(p.token_expires_at, new Date(0).toISOString());
  assertEquals(p.authorization_status, "disconnected");
  assertEquals(p.last_synced_at, null);
});

Deno.test("erro ao apagar análises propaga", async () => {
  const { svc, calls } = fakeSvc("instagram_comment_analyses");
  let threw = false;
  try {
    await disconnectAccount(svc, "acc-1");
  } catch {
    threw = true;
  }
  assert(threw);
  assert(!calls.some((c) => c.table === "instagram_accounts"), "token must not be blanked");
});
