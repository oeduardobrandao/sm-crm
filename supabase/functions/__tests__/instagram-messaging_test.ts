import { assert, assertEquals } from "./assert.ts";
import {
  classifyIgError, fetchSubscribedFields, IgApiError, replyToComment, sendPrivateReply,
} from "../_shared/instagram-messaging.ts";

function fakeFetch(status: number, body: unknown): typeof fetch {
  // deno-lint-ignore no-explicit-any
  return ((input: any, init: any) => {
    fakeFetch.last = { url: String(input), init };
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }) as unknown as typeof fetch;
}
// deno-lint-ignore no-explicit-any
fakeFetch.last = null as any;

Deno.test("sendPrivateReply: POST /messages com Bearer e recipient.comment_id", async () => {
  const fetchFn = fakeFetch(200, { message_id: "m1" });
  await sendPrivateReply(
    { fetchFn },
    { igUserId: "17840001", token: "tk", commentId: "c1", message: { text: "oi" } },
  );
  assert(fakeFetch.last.url.endsWith("/17840001/messages"));
  assertEquals(fakeFetch.last.init.headers["Authorization"], "Bearer tk");
  assertEquals(JSON.parse(fakeFetch.last.init.body), {
    recipient: { comment_id: "c1" }, message: { text: "oi" },
  });
});

Deno.test("sendPrivateReply: aceita button template e envia o attachment inteiro", async () => {
  const fetchFn = fakeFetch(200, { message_id: "m2" });
  const message = {
    attachment: {
      type: "template" as const,
      payload: {
        template_type: "button" as const,
        text: "Escolha:",
        buttons: [{ type: "web_url" as const, url: "https://agenda.x", title: "Agendar" }],
      },
    },
  };
  await sendPrivateReply({ fetchFn }, { igUserId: "17840001", token: "tk", commentId: "c1", message });
  assertEquals(JSON.parse(fakeFetch.last.init.body), {
    recipient: { comment_id: "c1" },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: "Escolha:",
          buttons: [{ type: "web_url", url: "https://agenda.x", title: "Agendar" }],
        },
      },
    },
  });
});

Deno.test("replyToComment devolve o id da reply", async () => {
  const fetchFn = fakeFetch(200, { id: "r9" });
  const out = await replyToComment({ fetchFn }, { commentId: "c1", token: "tk", text: "respondido" });
  assertEquals(out.replyId, "r9");
});

Deno.test("erro 190 vira kind token_expired; 4/9/17/613 viram transient", async () => {
  for (const [code, kind] of [[190, "token_expired"], [4, "transient"], [613, "transient"]] as const) {
    const fetchFn = fakeFetch(400, { error: { message: "x", code } });
    try {
      await sendPrivateReply({ fetchFn }, { igUserId: "1", token: "t", commentId: "c", message: { text: "y" } });
      assert(false, "devia lançar");
    } catch (e) {
      assert(e instanceof IgApiError);
      assertEquals((e as IgApiError).kind, kind);
    }
  }
});

Deno.test("mensagem de 'private reply já enviada' vira kind already_replied", () => {
  const err = new IgApiError("The comment has already received a private reply", { graphCode: 10 });
  assertEquals(classifyIgError(err), "already_replied");
});

Deno.test("fetchSubscribedFields devolve nomes dos campos assinados", async () => {
  const fetchFn = fakeFetch(200, { data: [{ subscribed_fields: ["comments"] }] });
  assertEquals(await fetchSubscribedFields({ fetchFn }, "tk"), ["comments"]);
});

Deno.test("classifyIgError respeita err.kind mesmo com overlap 190 + already_replied", () => {
  const e = new IgApiError("The comment has already received a private reply", { graphCode: 190 });
  assertEquals(e.kind, "already_replied");
  assertEquals(classifyIgError(e), e.kind);
});
