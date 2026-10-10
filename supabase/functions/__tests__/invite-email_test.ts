import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildInviteEmail } from "../_shared/invite-email.ts";

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
