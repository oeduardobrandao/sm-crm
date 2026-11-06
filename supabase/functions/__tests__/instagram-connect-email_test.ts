import { assert, assertEquals } from "./assert.ts";
import {
  buildConnectedNoticeEmail,
  buildConnectLinkEmail,
  CONNECT_LINK_SUBJECT,
  sendConnectedNoticeEmail,
  sendConnectLinkEmail,
} from "../_shared/instagram-connect-email.ts";

const BASE = "https://app.mesaas.com.br";

Deno.test("CONNECT_LINK_SUBJECT: leads with the agency name, not with Mesaas", () => {
  // O cliente recebe e-mail de um domínio que ele não conhece, no momento exato em que
  // é convidado a autorizar uma conta. O assunto tem que abrir com quem ele conhece.
  const subject = CONNECT_LINK_SUBJECT("Agência Y");
  assertEquals(subject.startsWith("Agência Y"), true);
});

Deno.test("CONNECT_LINK_SUBJECT: strips control characters from the workspace name", () => {
  // O nome do workspace é controlado pelo usuário. Um caractere de controle no
  // assunto faz a Resend recusar o envio inteiro.
  const subject = CONNECT_LINK_SUBJECT("Agência\r\nBcc: alguem@exemplo.com");
  assertEquals(subject.includes("\r"), false);
  assertEquals(subject.includes("\n"), false);
});

Deno.test("CONNECT_LINK_SUBJECT: bounds an absurdly long workspace name", () => {
  const subject = CONNECT_LINK_SUBJECT("N".repeat(500));
  assertEquals(subject.length < 130, true);
});

Deno.test("buildConnectLinkEmail: contains both names and the link", () => {
  const html = buildConnectLinkEmail({
    agencyName: "Agência Y",
    clienteName: "Clínica X",
    connectUrl: `${BASE}/conectar/tok-123`,
    appBaseUrl: BASE,
  });
  assertEquals(html.includes("Agência Y"), true);
  assertEquals(html.includes("Clínica X"), true);
  assertEquals(html.includes(`${BASE}/conectar/tok-123`), true);
});

Deno.test("buildConnectLinkEmail: escapes names into the HTML", () => {
  const html = buildConnectLinkEmail({
    agencyName: '<script>alert(1)</script>',
    clienteName: "Tom & Jerry",
    connectUrl: `${BASE}/conectar/tok-123`,
    appBaseUrl: BASE,
  });
  assertEquals(html.includes("<script>"), false);
  assertEquals(html.includes("Tom &amp; Jerry"), true);
});

Deno.test("buildConnectLinkEmail: no em-dash in user-visible copy", () => {
  const html = buildConnectLinkEmail({
    agencyName: "Agência Y",
    clienteName: "Clínica X",
    connectUrl: `${BASE}/conectar/tok-123`,
    appBaseUrl: BASE,
  });
  assertEquals(html.includes("—"), false);
});

Deno.test("buildConnectedNoticeEmail: names the client and the @username", () => {
  const html = buildConnectedNoticeEmail({
    clienteName: "Clínica X",
    igUsername: "clinicax",
    clienteUrl: `${BASE}/clientes/42`,
    appBaseUrl: BASE,
  });
  assertEquals(html.includes("Clínica X"), true);
  assertEquals(html.includes("@clinicax"), true);
  assertEquals(html.includes(`${BASE}/clientes/42`), true);
  assertEquals(html.includes("—"), false);
});

Deno.test("connect link: eyebrow, steps, fallback link, new shell", () => {
  const html = buildConnectLinkEmail({ agencyName: "Agência Lume", clienteName: "Clínica <S>", connectUrl: "https://app.test/c/abc", appBaseUrl: "https://app.test" });
  assert(html.includes("A pedido de Agência Lume"));
  assert(html.includes("Conecte o Instagram de Clínica &lt;S&gt;"));
  assert(html.includes("Se o botão não funcionar") && html.includes("https://app.test/c/abc"));
  assert(html.includes("logo-black-email.png") && !html.includes("#1a3d2b"));
});

Deno.test("connected notice: eyebrow and button", () => {
  const html = buildConnectedNoticeEmail({ clienteName: "Clínica", igUsername: "clinica", clienteUrl: "https://app.test/clientes/1", appBaseUrl: "https://app.test" });
  assert(html.includes("Instagram conectado") && html.includes("@clinica") && html.includes("Ver o cliente"));
});

Deno.test("send functions tag the email: instagram_connect and instagram_connected", async () => {
  const original = globalThis.fetch;
  const prevKey = Deno.env.get("RESEND_API_KEY");
  Deno.env.set("RESEND_API_KEY", "test-key");
  const tags: unknown[] = [];
  globalThis.fetch = ((_i: unknown, init?: RequestInit) => {
    tags.push(JSON.parse(String(init?.body ?? "{}")).tags);
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  try {
    await sendConnectLinkEmail({
      to: "c@x.test",
      replyTo: "ag@x.test",
      agencyName: "Ag",
      clienteName: "Cli",
      connectUrl: "https://x.test/c",
      appBaseUrl: BASE,
      idempotencyKey: "k1",
    });
    await sendConnectedNoticeEmail({
      to: "ag@x.test",
      clienteName: "Cli",
      igUsername: "cli",
      clienteUrl: "https://x.test/clientes/1",
      appBaseUrl: BASE,
      idempotencyKey: "k2",
    });
  } finally {
    globalThis.fetch = original;
    if (prevKey === undefined) Deno.env.delete("RESEND_API_KEY");
    else Deno.env.set("RESEND_API_KEY", prevKey);
  }
  assertEquals(tags, [[{ name: "type", value: "instagram_connect" }], [{ name: "type", value: "instagram_connected" }]]);
});
