import { assertEquals } from "./assert.ts";
import {
  buildConnectedNoticeEmail,
  buildConnectLinkEmail,
  CONNECT_LINK_SUBJECT,
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
