import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildDemoAccessEmail, buildInviteEmail, type DemoSeedCounts } from "../_shared/invite-email.ts";

Deno.test("buildInviteEmail: includes the action link and workspace name", () => {
  const html = buildInviteEmail({
    actionLink: "https://x.test/verify?token=abc",
    workspaceName: "Agência Z",
  });
  assertStringIncludes(html, "https://x.test/verify?token=abc");
  assertStringIncludes(html, "Agência Z");
});

Deno.test("buildInviteEmail: escapes HTML in the workspace name (XSS)", () => {
  const html = buildInviteEmail({
    actionLink: "https://x.test/v",
    workspaceName: "<script>alert(1)</script>",
  });
  assertEquals(html.includes("<script>alert(1)</script>"), false);
  assertStringIncludes(html, "&lt;script&gt;");
});

Deno.test("buildInviteEmail: escapes ampersands in the action link", () => {
  const html = buildInviteEmail({
    actionLink: "https://x.test/v?a=1&b=2",
    workspaceName: "W",
  });
  // Raw '&b=' would be an invalid/unescaped entity in HTML attribute context.
  assertEquals(html.includes("?a=1&b=2"), false);
  assertStringIncludes(html, "?a=1&amp;b=2");
});

Deno.test("invite: new shell, fallback link, escaped workspace", () => {
  const html = buildInviteEmail({ actionLink: "https://auth.test/verify?a=1&b=2", workspaceName: "Agência <L>" });
  assert(html.includes("Você foi convidado para o Agência &lt;L&gt;"));
  assert(html.includes("Definir minha senha") && html.includes("Se o botão não funcionar"));
  assert(html.includes(`href="https://auth.test/verify?a=1&amp;b=2"`));
  assert(html.includes("logo-black-email.png") && !html.includes("#1a3d2b"));
});

const demoCounts: DemoSeedCounts = { membros: 0, clientes: 1, workflows: 0, posts: 6, ideias: 3, leads: 0, eventos: 1 };
const demoBase = { actionLink: "https://auth.test/v?a=1&b=2", nome: "Ana", planName: "Pro", counts: demoCounts };

Deno.test("buildDemoAccessEmail greets by name and names the plan", () => {
  const html = buildDemoAccessEmail(demoBase);
  assertStringIncludes(html, "Olá, Ana.");
  assertStringIncludes(html, "plano Pro");
  assertStringIncludes(html, "um cliente, posts, ideias e um evento na agenda");
});

Deno.test('buildDemoAccessEmail without a name greets with "Olá."', () => {
  const html = buildDemoAccessEmail({ ...demoBase, nome: null });
  assertStringIncludes(html, "Olá.");
  assertEquals(html.includes("Olá,"), false);
});

Deno.test("buildDemoAccessEmail lists only seeded examples", () => {
  const html = buildDemoAccessEmail({ ...demoBase, counts: { ...demoCounts, leads: 0, eventos: 0 } });
  assertEquals(html.includes("evento na agenda"), false);
  assertEquals(html.includes("leads"), false);
  const withLeads = buildDemoAccessEmail({ ...demoBase, counts: { ...demoCounts, leads: 2 } });
  assertStringIncludes(withLeads, "leads");
});

Deno.test('buildDemoAccessEmail has the button and never says "convidado" or an em-dash', () => {
  const html = buildDemoAccessEmail(demoBase);
  assertStringIncludes(html, "Definir minha senha");
  assertStringIncludes(html, `href="https://auth.test/v?a=1&amp;b=2"`);
  assertStringIncludes(html, "Sua conta Mesaas está pronta");
  assertEquals(html.includes("convidado"), false);
  assertEquals(html.includes("\u2014"), false);
});

Deno.test("buildDemoAccessEmail escapes the name", () => {
  const html = buildDemoAccessEmail({ ...demoBase, nome: "<b>x</b>" });
  assertEquals(html.includes("<b>x</b>"), false);
  assertStringIncludes(html, "&lt;b&gt;");
});
