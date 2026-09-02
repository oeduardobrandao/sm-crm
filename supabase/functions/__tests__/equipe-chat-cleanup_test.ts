import { assertEquals } from "./assert.ts";
import {
  runEquipeChatCleanup,
  type EquipeChatCleanupDeps,
} from "../post-media-cleanup-cron/equipe-chat-cleanup.ts";

type StagedRow = { id: number };
type DbError = { message: string };

function makeDb(opts: {
  stagedRows?: StagedRow[];
  stagedError?: DbError | null;
  // by anexo id: string r2_key = released, null = send won the race
  releaseResponses?: Record<number, string | null>;
  releaseErrors?: Record<number, DbError>;
}) {
  const rpcCalls: Array<{ fn: string; params: { p_anexo_id: number } }> = [];
  const db: EquipeChatCleanupDeps["db"] = {
    from(_table: "equipe_mensagem_anexos") {
      return {
        select(_columns: string) {
          return {
            is(_column: string, _value: null) {
              return {
                lt(_column: string, _value: string) {
                  return {
                    limit(_n: number) {
                      return Promise.resolve({
                        data: opts.stagedRows ?? [],
                        error: opts.stagedError ?? null,
                      });
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
    rpc(fn: "equipe_chat_anexo_release", params: { p_anexo_id: number }) {
      rpcCalls.push({ fn, params });
      const err = opts.releaseErrors?.[params.p_anexo_id];
      if (err) return Promise.resolve({ data: null, error: err });
      const key = opts.releaseResponses?.[params.p_anexo_id] ?? null;
      return Promise.resolve({ data: key, error: null });
    },
  };
  return { db, rpcCalls };
}

Deno.test("equipe-chat-cleanup: tmp sweep trashes every abandoned upload key", async () => {
  const { db } = makeDb({ stagedRows: [] });
  const trashed: string[] = [];
  let listArgs: [string, number] | null = null;
  const result = await runEquipeChatCleanup({
    db,
    listOrphanKeys: async (prefix, olderThanMs) => {
      listArgs = [prefix, olderThanMs];
      return ["equipe-chat-tmp/w/a.png", "equipe-chat-tmp/w/b.png"];
    },
    trashObject: async (key) => {
      trashed.push(key);
    },
  });
  assertEquals(listArgs, ["equipe-chat-tmp/", 24 * 60 * 60 * 1000]);
  assertEquals(trashed, ["equipe-chat-tmp/w/a.png", "equipe-chat-tmp/w/b.png"]);
  assertEquals(result.tmpTrashed, 2);
  assertEquals(result.failed, 0);
});

Deno.test("equipe-chat-cleanup: staged reap only trashes when the RPC releases a key", async () => {
  const { db, rpcCalls } = makeDb({
    stagedRows: [{ id: 1 }, { id: 2 }],
    // id 1: released (cron won) -> trash. id 2: send won the race -> NULL, no trash.
    releaseResponses: { 1: "equipe-chat/w/staged-1.png", 2: null },
  });
  const trashed: string[] = [];
  const result = await runEquipeChatCleanup({
    db,
    listOrphanKeys: async () => [],
    trashObject: async (key) => {
      trashed.push(key);
    },
  });
  assertEquals(rpcCalls, [
    { fn: "equipe_chat_anexo_release", params: { p_anexo_id: 1 } },
    { fn: "equipe_chat_anexo_release", params: { p_anexo_id: 2 } },
  ]);
  assertEquals(trashed, ["equipe-chat/w/staged-1.png"]);
  assertEquals(result.stagedReleased, 1);
  assertEquals(result.failed, 0);
});

Deno.test("equipe-chat-cleanup: a failure on one item never derails the rest of the leg", async () => {
  const { db } = makeDb({
    stagedRows: [{ id: 1 }, { id: 2 }],
    releaseResponses: { 1: "equipe-chat/w/staged-1.png", 2: "equipe-chat/w/staged-2.png" },
  });
  const trashed: string[] = [];
  const result = await runEquipeChatCleanup({
    db,
    listOrphanKeys: async () => ["equipe-chat-tmp/w/bad.png", "equipe-chat-tmp/w/good.png"],
    trashObject: async (key) => {
      if (key === "equipe-chat-tmp/w/bad.png" || key === "equipe-chat/w/staged-1.png") {
        throw new Error("r2 delete failed: 500");
      }
      trashed.push(key);
    },
  });
  // Tmp sweep: one throws, one succeeds.
  assertEquals(trashed.includes("equipe-chat-tmp/w/good.png"), true);
  assertEquals(result.tmpTrashed, 1);
  // Staged reap: id 1's trashObject throws, id 2 still processes normally.
  assertEquals(trashed.includes("equipe-chat/w/staged-2.png"), true);
  assertEquals(result.stagedReleased, 1);
  // Both failures counted, neither one stalled the other item or the other leg.
  assertEquals(result.failed, 2);
});

Deno.test("equipe-chat-cleanup: listOrphanKeys rejecting fails the tmp leg but staged reap still runs", async () => {
  const { db } = makeDb({
    stagedRows: [{ id: 1 }],
    releaseResponses: { 1: "equipe-chat/w/staged-1.png" },
  });
  const trashed: string[] = [];
  const result = await runEquipeChatCleanup({
    db,
    listOrphanKeys: async () => {
      throw new Error("r2 list timed out");
    },
    trashObject: async (key) => {
      trashed.push(key);
    },
  });
  assertEquals(result.tmpTrashed, 0);
  assertEquals(result.stagedReleased, 1);
  assertEquals(trashed, ["equipe-chat/w/staged-1.png"]);
  assertEquals(result.failed, 1);
});

Deno.test("equipe-chat-cleanup: staged query itself failing counts as one failure, no rows processed", async () => {
  const { db } = makeDb({
    stagedError: { message: "connection reset" },
  });
  const trashed: string[] = [];
  const result = await runEquipeChatCleanup({
    db,
    listOrphanKeys: async () => [],
    trashObject: async (key) => {
      trashed.push(key);
    },
  });
  assertEquals(result.stagedReleased, 0);
  assertEquals(trashed, []);
  assertEquals(result.failed, 1);
});

Deno.test("equipe-chat-cleanup: RPC error on one row is caught and does not throw", async () => {
  const { db } = makeDb({
    stagedRows: [{ id: 1 }, { id: 2 }],
    releaseErrors: { 1: { message: "deadlock detected" } },
    releaseResponses: { 2: "equipe-chat/w/staged-2.png" },
  });
  const trashed: string[] = [];
  const result = await runEquipeChatCleanup({
    db,
    listOrphanKeys: async () => [],
    trashObject: async (key) => {
      trashed.push(key);
    },
  });
  assertEquals(trashed, ["equipe-chat/w/staged-2.png"]);
  assertEquals(result.stagedReleased, 1);
  assertEquals(result.failed, 1);
});
