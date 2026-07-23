import { assertEquals } from "./assert.ts";
import { assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sendPendingWorkspaceInvite } from "../_shared/invite-pending.ts";

const input = {
  contaId: "11111111-1111-4111-8111-111111111111",
  email: "invitee@example.com",
  role: "agent" as const,
  invitedBy: "22222222-2222-4222-8222-222222222222",
  redirectTo: "https://app.example/configurar-senha",
};

Deno.test("pending invite is persisted before Auth invitation", async () => {
  const events: string[] = [];
  const id = await sendPendingWorkspaceInvite({
    createPendingInvite: async () => {
      events.push("create");
      return { id: "invite-1" };
    },
    sendAuthInvite: async () => {
      events.push("send");
    },
    deletePendingInvite: async () => {
      events.push("delete");
    },
  }, input);

  assertEquals(id, "invite-1");
  assertEquals(events, ["create", "send"]);
});

Deno.test("Auth failure removes only the newly persisted invite", async () => {
  const deleted: string[] = [];

  await assertRejects(
    () => sendPendingWorkspaceInvite({
      createPendingInvite: async () => ({ id: "invite-new" }),
      sendAuthInvite: async () => {
        throw new Error("auth unavailable");
      },
      deletePendingInvite: async (id) => {
        deleted.push(id);
      },
    }, input),
    Error,
    "auth unavailable",
  );

  assertEquals(deleted, ["invite-new"]);
});

Deno.test("cleanup failure preserves the original Auth error", async () => {
  const original = console.error;
  console.error = () => undefined;
  try {
    await assertRejects(
      () => sendPendingWorkspaceInvite({
        createPendingInvite: async () => ({ id: "invite-new" }),
        sendAuthInvite: async () => {
          throw new Error("auth unavailable");
        },
        deletePendingInvite: async () => {
          throw new Error("cleanup unavailable");
        },
      }, input),
      Error,
      "auth unavailable",
    );
  } finally {
    console.error = original;
  }
});
