import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildClientEventEmail,
  clientEventSubject,
  signUnsubToken,
  verifyUnsubToken,
} from "../_shared/client-event-email.ts";

const SECRET = "test-secret";

const BASE_PARAMS = {
  clienteNome: "Ana Souza",
  workspaceName: "Agencia X",
  brandColor: "#ffbf30",
  logoUrl: null as string | null,
  pendingPosts: [{ titulo: "Post 1" }],
  unreadMessages: 0,
  hubUrl: "https://app.mesaas.com.br/w/agencia-x/hub/tok123",
  unsubUrl: "https://app.mesaas.com.br/api/unsub?t=abc",
};

// --- buildClientEventEmail ---------------------------------------------------

Deno.test("lists pending post titles, escaped", () => {
  const html = buildClientEventEmail({
    ...BASE_PARAMS,
    pendingPosts: [{ titulo: "<b>Post</b> especial" }, { titulo: "Post normal" }],
  });
  assert(html.includes("&lt;b&gt;Post&lt;/b&gt; especial"), "post title not escaped");
  assert(!html.includes("<b>Post</b> especial"), "raw post title leaked");
  assert(html.includes("Post normal"), "second post title missing");
});

Deno.test("escapes clienteNome and workspaceName", () => {
  const html = buildClientEventEmail({
    ...BASE_PARAMS,
    clienteNome: "<script>alert(1)</script>",
    workspaceName: "<i>Agencia</i>",
  });
  assert(
    html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"),
    "clienteNome not escaped",
  );
  assert(!html.includes("<script>alert(1)</script>"), "raw clienteNome leaked");
  assert(html.includes("&lt;i&gt;Agencia&lt;/i&gt;"), "workspaceName not escaped");
  assert(!html.includes("<i>Agencia</i>"), "raw workspaceName leaked");
});

Deno.test("shows unread message count only when greater than zero", () => {
  const withUnread = buildClientEventEmail({ ...BASE_PARAMS, unreadMessages: 3 });
  assert(withUnread.includes("3 mensagens não lidas"), "unread count copy missing");

  const noUnread = buildClientEventEmail({ ...BASE_PARAMS, unreadMessages: 0 });
  assert(!noUnread.includes("mensagens não lidas"), "unread copy rendered with zero messages");
});

Deno.test("Hub button is present with a hubUrl and absent when hubUrl is empty", () => {
  const withHub = buildClientEventEmail({ ...BASE_PARAMS, hubUrl: "https://x.test/hub/tok" });
  assert(withHub.includes("https://x.test/hub/tok"), "hub link missing");

  const noHub = buildClientEventEmail({ ...BASE_PARAMS, hubUrl: "" });
  assert(!noHub.includes('href=""'), "empty href rendered");
  // No dangling anchor referencing the (absent) hub link text either.
  assert(
    !/<a[^>]*href="\s*"[^>]*>/.test(noHub),
    "an anchor with an empty href leaked into the email",
  );
});

Deno.test("unsubscribe link is always present", () => {
  const html = buildClientEventEmail(BASE_PARAMS);
  assert(html.includes(BASE_PARAMS.unsubUrl), "unsub link missing");
});

Deno.test("unsubscribe link survives even without pending posts, unread messages, or hub url", () => {
  const html = buildClientEventEmail({
    ...BASE_PARAMS,
    pendingPosts: [],
    unreadMessages: 0,
    hubUrl: "",
  });
  assert(html.includes(BASE_PARAMS.unsubUrl), "unsub link missing in minimal render");
});

Deno.test("client event email never uses an em-dash", () => {
  const html = buildClientEventEmail({
    ...BASE_PARAMS,
    unreadMessages: 5,
    pendingPosts: [{ titulo: "Post A" }, { titulo: "Post B" }],
  });
  assert(!html.includes("—"), "em-dash found in client event email copy");
});

// --- clientEventSubject -------------------------------------------------------

Deno.test("clientEventSubject builds the spec'd subject line", () => {
  assertEquals(clientEventSubject("Agencia X"), "Você tem pendências com Agencia X");
});

Deno.test("clientEventSubject strips control characters from a hostile workspace name", () => {
  const subject = clientEventSubject("Evil\nName");
  assert(!subject.includes("\n"), "newline survived into the subject");
  assert(!subject.includes("\r"), "carriage return survived into the subject");
  assertEquals(subject, "Você tem pendências com Evil Name");
});

// --- token roundtrip -----------------------------------------------------------

Deno.test("signUnsubToken/verifyUnsubToken round-trip returns the clienteId", async () => {
  const token = await signUnsubToken(42, SECRET);
  assertEquals(await verifyUnsubToken(token, SECRET), 42);
});

Deno.test("tampered signature fails verification", async () => {
  const token = await signUnsubToken(42, SECRET);
  const [payload] = token.split(".");
  assertEquals(await verifyUnsubToken(`${payload}.AAAA`, SECRET), null);
});

Deno.test("tampered payload fails verification", async () => {
  const token = await signUnsubToken(42, SECRET);
  const sig = token.split(".")[1];
  const forgedPayload = btoa(JSON.stringify({ c: 999 }))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  assertEquals(await verifyUnsubToken(`${forgedPayload}.${sig}`, SECRET), null);
});

Deno.test("wrong secret fails verification", async () => {
  const token = await signUnsubToken(42, SECRET);
  assertEquals(await verifyUnsubToken(token, "other-secret"), null);
});

Deno.test("malformed tokens return null without throwing", async () => {
  assertEquals(await verifyUnsubToken("garbage", SECRET), null);
  assertEquals(await verifyUnsubToken("a.b", SECRET), null);
  assertEquals(await verifyUnsubToken(".", SECRET), null);
  assertEquals(await verifyUnsubToken("", SECRET), null);
});
