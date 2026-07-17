import { assert, assertEquals } from "./assert.ts";
import { buildDunningCopy, buildDunningEmail } from "../_shared/dunning-email.ts";

Deno.test("buildDunningCopy: the first notice stays soft and names the retry date", () => {
  const copy = buildDunningCopy("first", "Agência DK", "24 de julho");
  assert(copy.subject.includes("Agência DK"));
  assert(copy.body.includes("24 de julho"));
  // The common cause is an expired card, not a refusal — the first mail must not threaten.
  assert(!copy.body.includes("Free"));
});

Deno.test("buildDunningCopy: the final notice states the consequence", () => {
  const copy = buildDunningCopy("final", "Agência DK", null);
  assert(copy.subject.includes("Último aviso"));
  assert(copy.body.includes("Free"));
});

Deno.test("buildDunningCopy: retry copy without a known date omits the date sentence", () => {
  const copy = buildDunningCopy("retry", "Agência DK", null);
  assert(!copy.body.includes("undefined"));
  assert(!copy.body.includes("null"));
});

Deno.test("buildDunningEmail: escapes the workspace name", () => {
  const html = buildDunningEmail({
    stage: "first",
    workspaceName: '<script>alert("x")</script>',
    nextAttemptLabel: "24 de julho",
    billingUrl: "https://app.example.com/configuracao/cobranca",
  });
  assert(!html.includes("<script>"));
  assert(html.includes("&lt;script&gt;"));
});

Deno.test("buildDunningEmail: links the billing page", () => {
  const html = buildDunningEmail({
    stage: "final",
    workspaceName: "Agência DK",
    nextAttemptLabel: null,
    billingUrl: "https://app.example.com/configuracao/cobranca",
  });
  assert(html.includes("https://app.example.com/configuracao/cobranca"));
});

Deno.test("buildDunningCopy: every stage produces a non-empty subject and cta", () => {
  for (const stage of ["first", "retry", "final"] as const) {
    const copy = buildDunningCopy(stage, "WS", "1 de agosto");
    assertEquals(copy.subject.length > 0, true);
    assertEquals(copy.cta.length > 0, true);
  }
});
