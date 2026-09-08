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
  pendingPosts: [{ titulo: "Post 1", tipo: "feed" }],
  unreadMessages: 0,
  hubUrl: "https://app.mesaas.com.br/w/agencia-x/hub/tok123",
  unsubUrl: "https://app.mesaas.com.br/api/unsub?t=abc",
};

// --- buildClientEventEmail ---------------------------------------------------

Deno.test("lists pending post titles, escaped", () => {
  const html = buildClientEventEmail({
    ...BASE_PARAMS,
    pendingPosts: [
      { titulo: "<b>Post</b> especial", tipo: "feed" },
      { titulo: "Post normal", tipo: "feed" },
    ],
  });
  assert(html.includes("&lt;b&gt;Post&lt;/b&gt; especial"), "post title not escaped");
  assert(!html.includes("<b>Post</b> especial"), "raw post title leaked");
  assert(html.includes("Post normal"), "second post title missing");
});

Deno.test("caps the rendered post list at 20 and folds the rest into a summary line", () => {
  const pendingPosts = Array.from({ length: 25 }, (_, i) => ({ titulo: `Post ${i + 1}`, tipo: "feed" }));
  const html = buildClientEventEmail({ ...BASE_PARAMS, pendingPosts });
  assert(html.includes("Post 1<"), "first post missing");
  assert(html.includes("Post 20<"), "20th post missing");
  assert(!html.includes("Post 21<"), "21st post rendered despite the cap");
  assert(!html.includes("Post 25<"), "25th post rendered despite the cap");
  assert(html.includes("e mais 5 posts aguardando aprovação."), "expected the overflow summary line");
});

Deno.test("no overflow line when pending posts are at or under the render cap", () => {
  const pendingPosts = Array.from({ length: 20 }, (_, i) => ({ titulo: `Post ${i + 1}`, tipo: "feed" }));
  const html = buildClientEventEmail({ ...BASE_PARAMS, pendingPosts });
  assert(html.includes("Post 20<"), "20th post missing");
  assert(!html.includes("e mais"), "overflow summary line rendered when nothing was cut");
});

Deno.test("escapes clienteNome, workspaceName and post titles", () => {
  const html = buildClientEventEmail({
    ...BASE_PARAMS,
    clienteNome: "<script>alert(1)</script>",
    workspaceName: "<i>Agencia</i>",
    pendingPosts: [{ titulo: "<img src=x onerror=alert(1)>", tipo: "feed" }],
  });
  assert(
    html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"),
    "clienteNome not escaped",
  );
  assert(!html.includes("<script>alert(1)</script>"), "raw clienteNome leaked");
  assert(html.includes("&lt;i&gt;Agencia&lt;/i&gt;"), "workspaceName not escaped");
  assert(!html.includes("<i>Agencia</i>"), "raw workspaceName leaked");
  assert(!html.includes("<img src=x"), "raw post titulo leaked unescaped");
});

// --- title adaptativo (spec §11) ----------------------------------------------

Deno.test("title: posts > 1 -> '{N} posts esperam sua aprovação'", () => {
  const pendingPosts = [
    { titulo: "A", tipo: "feed" },
    { titulo: "B", tipo: "feed" },
    { titulo: "C", tipo: "feed" },
  ];
  const html = buildClientEventEmail({ ...BASE_PARAMS, pendingPosts, unreadMessages: 4 });
  assert(html.includes("3 posts esperam sua aprovação"), "expected the plural posts title");
  assert(!html.includes("mensagens esperam você"), "messages title leaked when posts > 0");
});

Deno.test("title: exactly 1 post -> singular '1 post espera sua aprovação'", () => {
  const html = buildClientEventEmail({ ...BASE_PARAMS, pendingPosts: [{ titulo: "A", tipo: "feed" }] });
  assert(html.includes("1 post espera sua aprovação"), "expected the singular posts title");
  assert(!html.includes("1 posts"), "plural leaked for exactly 1 post");
});

Deno.test("title: 0 posts and messages > 0 -> '{M} mensagens esperam você'", () => {
  const html = buildClientEventEmail({ ...BASE_PARAMS, pendingPosts: [], unreadMessages: 2 });
  assert(html.includes("2 mensagens esperam você"), "expected the messages-only title");
});

Deno.test("title: 0 posts and exactly 1 message -> singular '1 mensagem espera você'", () => {
  const html = buildClientEventEmail({ ...BASE_PARAMS, pendingPosts: [], unreadMessages: 1 });
  assert(html.includes("1 mensagem espera você"), "expected the singular messages-only title");
  assert(!html.includes("1 mensagens"), "plural leaked for exactly 1 message");
});

Deno.test("title: both zero (unreachable in prod -- cron releases without sending) falls back without crashing", () => {
  const html = buildClientEventEmail({ ...BASE_PARAMS, pendingPosts: [], unreadMessages: 0 });
  assert(html.includes("Você tem novidades"), "expected the both-zero fallback title");
});

// --- saudação move para o corpo -------------------------------------------------

Deno.test("greeting: with posts, includes the 'dá uma olhada' body line", () => {
  const html = buildClientEventEmail({ ...BASE_PARAMS, pendingPosts: [{ titulo: "A", tipo: "feed" }] });
  assert(
    html.includes("Olá, Ana! Quando puder, dá uma olhada no que a equipe preparou:"),
    "expected the posts greeting body line",
  );
});

Deno.test("greeting: only messages, greeting is just 'Olá, {nome}!'", () => {
  const html = buildClientEventEmail({ ...BASE_PARAMS, pendingPosts: [], unreadMessages: 3 });
  assert(html.includes("Olá, Ana!"), "expected the bare greeting");
  assert(!html.includes("dá uma olhada"), "posts-flavored greeting leaked with no posts");
});

// --- ícone por tipo --------------------------------------------------------------

Deno.test("post row icon: feed, carrossel, reels, stories map to the spec'd emoji", () => {
  const pendingPosts = [
    { titulo: "P feed", tipo: "feed" },
    { titulo: "P carrossel", tipo: "carrossel" },
    { titulo: "P reels", tipo: "reels" },
    { titulo: "P stories", tipo: "stories" },
  ];
  const html = buildClientEventEmail({ ...BASE_PARAMS, pendingPosts });
  assert(html.includes("🖼"), "expected the feed icon");
  assert(html.includes("🗂"), "expected the carrossel icon");
  assert(html.includes("🎬"), "expected the reels icon");
  assert(html.includes("📱"), "expected the stories icon");
});

Deno.test("post row icon: unknown tipo falls back to 🖼", () => {
  const html = buildClientEventEmail({
    ...BASE_PARAMS,
    pendingPosts: [{ titulo: "Post estranho", tipo: "zzz" }],
  });
  assert(html.includes("🖼"), "expected the fallback icon for an unknown tipo");
});

// --- linha de mensagens ------------------------------------------------------------

Deno.test("shows unread message count only when greater than zero", () => {
  const withUnread = buildClientEventEmail({ ...BASE_PARAMS, unreadMessages: 3 });
  assert(withUnread.includes("3 mensagens não lidas"), "unread count copy missing");
  assert(withUnread.includes("da equipe esperando você."), "expected the full unread line copy");
  assert(withUnread.includes("#f8f9fa"), "expected the messages block's neutral background");

  const noUnread = buildClientEventEmail({ ...BASE_PARAMS, unreadMessages: 0 });
  assert(!noUnread.includes("mensagens não lidas"), "unread copy rendered with zero messages");
  assert(!noUnread.includes("mensagem não lida"), "singular unread copy rendered with zero messages");
});

Deno.test("unread message copy is singular for exactly 1, plural otherwise", () => {
  const one = buildClientEventEmail({ ...BASE_PARAMS, unreadMessages: 1 });
  assert(one.includes("1 mensagem não lida"), "expected singular copy for exactly 1 unread message");
  assert(!one.includes("1 mensagens"), "plural copy leaked for exactly 1 unread message");

  const two = buildClientEventEmail({ ...BASE_PARAMS, unreadMessages: 2 });
  assert(two.includes("2 mensagens não lidas"), "expected plural copy for 2 unread messages");
});

// --- CTA adaptativo -----------------------------------------------------------------

Deno.test("CTA: posts > 0 -> 'Revisar e aprovar'", () => {
  const html = buildClientEventEmail({
    ...BASE_PARAMS,
    hubUrl: "https://x.test/hub/tok",
    pendingPosts: [{ titulo: "A", tipo: "feed" }],
  });
  assert(html.includes(">Revisar e aprovar<"), "expected the posts CTA label");
  assert(!html.includes(">Ver mensagens<"), "messages CTA leaked with posts present");
});

Deno.test("CTA: only messages -> 'Ver mensagens'", () => {
  const html = buildClientEventEmail({
    ...BASE_PARAMS,
    hubUrl: "https://x.test/hub/tok",
    pendingPosts: [],
    unreadMessages: 2,
  });
  assert(html.includes(">Ver mensagens<"), "expected the messages-only CTA label");
  assert(!html.includes(">Revisar e aprovar<"), "posts CTA leaked with no posts");
});

Deno.test("CTA button background is brandColor and text follows pickHeaderTextColor", () => {
  const escura = buildClientEventEmail({ ...BASE_PARAMS, hubUrl: "https://x.test/hub/tok", brandColor: "#1a3d2b" });
  assert(escura.includes("background: #1a3d2b; color: #ffffff"), "expected white CTA text on a dark brandColor");

  const palida = buildClientEventEmail({ ...BASE_PARAMS, hubUrl: "https://x.test/hub/tok", brandColor: "#fef3c7" });
  assert(palida.includes("background: #fef3c7; color: #171717"), "expected dark CTA text on a pale brandColor");
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

// --- preheader dinâmico ----------------------------------------------------------------

Deno.test("preheader: both posts and messages present, joined with 'e', both counted", () => {
  const html = buildClientEventEmail({
    ...BASE_PARAMS,
    pendingPosts: [
      { titulo: "A", tipo: "feed" },
      { titulo: "B", tipo: "feed" },
      { titulo: "C", tipo: "feed" },
    ],
    unreadMessages: 2,
  });
  assert(
    html.includes("3 posts aguardando sua aprovação e 2 mensagens."),
    "expected the combined dynamic preheader text",
  );
  assert(html.includes("display:none"), "expected the preheader to be hidden");
});

Deno.test("preheader: only posts, omits the messages part entirely", () => {
  const html = buildClientEventEmail({
    ...BASE_PARAMS,
    pendingPosts: [
      { titulo: "A", tipo: "feed" },
      { titulo: "B", tipo: "feed" },
      { titulo: "C", tipo: "feed" },
    ],
    unreadMessages: 0,
  });
  assert(html.includes("3 posts aguardando sua aprovação."), "expected the posts-only preheader");
  assert(!/\d+ mensagens?\./.test(html.split("display:none")[1]?.slice(0, 200) ?? ""), "messages part leaked");
});

Deno.test("preheader: only messages, omits the posts part entirely", () => {
  const html = buildClientEventEmail({ ...BASE_PARAMS, pendingPosts: [], unreadMessages: 2 });
  assert(html.includes("2 mensagens."), "expected the messages-only preheader");
});

Deno.test("preheader: singular forms for exactly 1 post / 1 message", () => {
  const onePost = buildClientEventEmail({ ...BASE_PARAMS, pendingPosts: [{ titulo: "A", tipo: "feed" }], unreadMessages: 0 });
  assert(onePost.includes("1 post aguardando sua aprovação."), "expected singular post preheader");

  const oneMsg = buildClientEventEmail({ ...BASE_PARAMS, pendingPosts: [], unreadMessages: 1 });
  assert(oneMsg.includes("1 mensagem."), "expected singular message preheader");
});

// --- shell (faixa / radius / rodapé) --------------------------------------------------

Deno.test("shell: header band carries the real brandColor, card is 16px radius", () => {
  const html = buildClientEventEmail({ ...BASE_PARAMS, brandColor: "#e11d48" });
  assert(html.includes("background: #e11d48"), "expected the brandColor on the header band");
  assert(html.includes("border-radius: 16px"), "expected the 16px card radius");
});

Deno.test("shell: footer uses the cream palette, link inherits #888780, unsub text kept", () => {
  const html = buildClientEventEmail(BASE_PARAMS);
  assert(html.includes("#f5f3ee"), "expected the cream footer background");
  assert(html.includes("#888780"), "expected the cream footer text/link color");
  assert(html.includes("Não quero mais receber esses avisos"), "expected the unsub link copy to survive");
  assert(!html.includes("#9ca3af"), "expected the old grey footer color to be fully gone");
});

Deno.test("client event email never uses an em-dash", () => {
  const html = buildClientEventEmail({
    ...BASE_PARAMS,
    unreadMessages: 5,
    pendingPosts: [
      { titulo: "Post A", tipo: "feed" },
      { titulo: "Post B", tipo: "reels" },
    ],
  });
  assert(!html.includes("—"), "em-dash found in client event email copy");
});

// --- unsub link sempre presente -----------------------------------------------------

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
