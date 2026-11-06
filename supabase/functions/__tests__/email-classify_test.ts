import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyEmail,
  eventFromWebhookType,
  normalizeLastEvent,
  PII_EVENTS,
  tagValue,
} from "../_shared/email-classify.ts";
import { clientEventSubject } from "../_shared/client-event-email.ts";
import { CONNECT_LINK_SUBJECT, CONNECTED_NOTICE_SUBJECT } from "../_shared/instagram-connect-email.ts";
import { DEMO_ACCESS_SUBJECT } from "../_shared/invite-email.ts";
import { buildTrialReminderEmail, THANKYOU_SUBJECT, WELCOME_SUBJECT } from "../_shared/lifecycle-emails.ts";
import { buildNurtureEmail, NURTURE_SAMPLE, NURTURE_STEPS } from "../_shared/nurture-emails.ts";

const EDUARDO = "Eduardo do Mesaas <eduardo@mesaas.com.br>";
const NOTIF = "Agência X <notificacoes@mesaas.com.br>";

Deno.test("tag conhecida vence o remetente", () => {
  assertEquals(
    classifyEmail({ tags: { type: "nurture_b2" }, from: "Mesaas <alertas@mesaas.com.br>", subject: "x" }),
    { category: "ciclo_de_vida", type: "nurture_b2" },
  );
});

Deno.test("tag desconhecida cai no fallback", () => {
  assertEquals(
    classifyEmail({ tags: { type: "xyz" }, from: "Mesaas <cobranca@mesaas.com.br>", subject: "x" }),
    { category: "cobranca", type: "dunning" },
  );
});

Deno.test("remetentes fixos", () => {
  const c = (from: string, subject = "x") => classifyEmail({ from, subject });
  assertEquals(c("Mesaas Alerts <alertas@mesaas.com.br>").category, "interno");
  assertEquals(c("Mesaas <cobranca@mesaas.com.br>"), { category: "cobranca", type: "dunning" });
  assertEquals(c("Mesaas <afiliados@mesaas.com.br>"), { category: "afiliados", type: "affiliate_link" });
  assertEquals(c("Agência Aurora <relatorios@mesaas.com.br>"), { category: "relatorios", type: "report" });
  assertEquals(c("Mesaas <convites@mesaas.com.br>"), { category: "convites", type: "invite" });
  assertEquals(c("Mesaas <convites@mesaas.com.br>", DEMO_ACCESS_SUBJECT), {
    category: "convites",
    type: "demo_access",
  });
});

Deno.test("paridade de assuntos dos builders de nurture (eduardo@)", () => {
  const base = { ...NURTURE_SAMPLE, appBaseUrl: "https://x.test", unsubUrl: "https://x.test/u", whatsappUrl: null };
  for (const step of NURTURE_STEPS) {
    const { subject } = buildNurtureEmail({ ...base, step });
    // a3 and b1 without clients share one subject.
    const expected = step === "a4" || step === "b4"
      ? "nurture_a4_b4"
      : step === "a3" || (step === "b1" && NURTURE_SAMPLE.clientCount === 0)
      ? "nurture_a3_b1"
      : `nurture_${step}`;
    assertEquals(classifyEmail({ from: EDUARDO, subject }).type, expected, step);
  }
  for (const clientCount of [1, 2, 5]) {
    const { subject } = buildNurtureEmail({ ...base, step: "b1", clientCount });
    assertEquals(classifyEmail({ from: EDUARDO, subject }).type, "nurture_b1", `b1 n=${clientCount}`);
  }
  const { subject: b1zero } = buildNurtureEmail({ ...base, step: "b1", clientCount: 0 });
  assertEquals(classifyEmail({ from: EDUARDO, subject: b1zero }).category, "ciclo_de_vida");
  assertEquals(classifyEmail({ from: EDUARDO, subject: b1zero }).type, "nurture_a3_b1");
  const { subject: a3s } = buildNurtureEmail({ ...base, step: "a3" });
  assertEquals(classifyEmail({ from: EDUARDO, subject: a3s }).type, "nurture_a3_b1");
});

Deno.test("paridade de assuntos de ciclo de vida (eduardo@)", () => {
  const c = (subject: string) => classifyEmail({ from: EDUARDO, subject });
  assertEquals(c(WELCOME_SUBJECT).type, "welcome");
  assertEquals(c(THANKYOU_SUBJECT).type, "thank_you");
  for (const planName of [null, "Pro"]) {
    for (const daysLeft of [1, 7]) {
      const { subject } = buildTrialReminderEmail({
        firstName: "Ana",
        workspaceName: "W",
        planName,
        firstCharge: null,
        firstChargeDate: "10/12",
        daysLeft,
        appBaseUrl: "https://x.test",
      });
      assertEquals(c(subject).type, "trial_reminder", `${planName}/${daysLeft}`);
    }
  }
  assertEquals(c(CONNECT_LINK_SUBJECT("Agência Ação (SP) 🚀")).type, "instagram_connect");
  assertEquals(c(CONNECTED_NOTICE_SUBJECT).type, "instagram_connected");
});

Deno.test("notificacoes@", () => {
  assertEquals(classifyEmail({ from: NOTIF, subject: clientEventSubject("Agência X") }), {
    category: "notificacoes",
    type: "client_event",
  });
  assertEquals(classifyEmail({ from: NOTIF, subject: "outra coisa" }), {
    category: "notificacoes",
    type: "notificacao",
  });
});

Deno.test("fora do dominio e nao mapeados", () => {
  assertEquals(classifyEmail({ from: "a@outro.com", subject: "x" }), { category: "externo", type: "desconhecido" });
  assertEquals(classifyEmail({ from: EDUARDO, subject: "algo novo" }), {
    category: "ciclo_de_vida",
    type: "desconhecido",
  });
  assertEquals(classifyEmail({ from: "X <novo@mesaas.com.br>", subject: "x" }), {
    category: "outros",
    type: "desconhecido",
  });
});

Deno.test("normalizeLastEvent", () => {
  const cases: Array<[string, string]> = [
    ["opened", "delivered"],
    ["clicked", "delivered"],
    ["queued", "sent"],
    ["scheduled", "sent"],
    ["canceled", "canceled"],
    ["bounced", "bounced"],
    ["nope", "sent"],
  ];
  for (const [i, o] of cases) assertEquals(normalizeLastEvent(i), o, i);
});

Deno.test("eventFromWebhookType", () => {
  assertEquals(eventFromWebhookType("email.opened"), null);
  assertEquals(eventFromWebhookType("email.clicked"), null);
  assertEquals(eventFromWebhookType("email.canceled"), null);
  assertEquals(eventFromWebhookType("domain.created"), null);
  for (
    const e of ["sent", "delivery_delayed", "delivered", "failed", "suppressed", "bounced", "complained"]
  ) assertEquals(eventFromWebhookType(`email.${e}`), e);
});

Deno.test("PII_EVENTS e tagValue", () => {
  assertEquals([...PII_EVENTS].sort(), ["bounced", "complained", "failed", "suppressed"]);
  assertEquals(tagValue("nurture_a1"), "nurture_a1");
  assertEquals(tagValue("ação"), "a__o");
});
