/**
 * Client-facing e-mails (Hub digest, Agenda client/guest incl. .ics, Agenda reminder, Hub login
 * code) and the unsubscribe page in the workspace language. The pt half compares every render
 * with `fixtures/client-email-pt.json`, captured from the code before the language change
 * (inputs in `fixtures/client-email-cases.ts`).
 */
import { assert, assertEquals } from "./assert.ts";
import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AGENDA_ITEMS, renderAll, WHEN_CASES } from "./fixtures/client-email-cases.ts";
import { buildClientEventEmail, clientEventSubject, linhaItemText } from "../_shared/client-event-email.ts";
import { formatarQuandoAgenda, mesDiaAgenda, montarEmailAgendaCliente } from "../_shared/agenda-cliente-email.ts";
import { buildLembreteEmail } from "../_shared/agenda-email.ts";
import { buildLoginCodeEmail } from "../hub-auth/email.ts";
import { createClientEmailUnsubHandler } from "../client-email-unsub/handler.ts";

const FIX = JSON.parse(await Deno.readTextFile(new URL("./fixtures/client-email-pt.json", import.meta.url))) as Record<string, string>;
const ACCENT = /[ãçõáéíóúâêôà—]/;
const textOf = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ");
const APP = "https://app.test";
const HUB = `${APP}/lume/hub/tok`;

// --- pt unchanged ------------------------------------------------------------

Deno.test("pt unchanged: every client e-mail render equals the pre-change capture", () => {
  const now = renderAll("pt");
  assertEquals(Object.keys(now).sort(), Object.keys(FIX).sort());
  for (const [k, v] of Object.entries(FIX)) {
    if (now[k] !== v) throw new Error(`pt render changed for ${k}`);
  }
});

Deno.test("undefined lang renders pt", () => {
  const now = renderAll(undefined);
  for (const [k, v] of Object.entries(FIX)) {
    if (now[k] !== v) throw new Error(`undefined lang changed ${k}`);
  }
  assertEquals(renderAll("fr" as never)["ce/1 post"], FIX["ce/1 post"]);
});

// --- en: client-event digest -------------------------------------------------

const CE = {
  clienteNome: "Mary Costa",
  workspaceName: "Lume Agency",
  brandColor: "#7c3aed",
  logoUrl: null,
  pendingPosts: [{ titulo: "Carousel", tipo: "carrossel" }, { titulo: "Reel", tipo: "reels" }],
  unreadMessages: 2,
  hubUrl: HUB,
  unsubUrl: `${APP}/unsub/x`,
  lang: "en" as const,
};

Deno.test("en: digest subject, title, body phrases and footer", () => {
  assertEquals(clientEventSubject("Lume Agency", "en"), "You have pending items with Lume Agency");
  const html = buildClientEventEmail(CE);
  assertStringIncludes(html, '<html lang="en"');
  assertStringIncludes(html, "2 posts are waiting for your approval");
  assertStringIncludes(html, "Hi Mary! When you have a moment, take a look at what the team prepared:");
  assertStringIncludes(html, "Carousel");
  assertStringIncludes(html, "<strong>2 unread messages</strong> from the team are waiting for you.");
  assertStringIncludes(html, "Review and approve");
  assertStringIncludes(html, "Sent by Lume Agency via Mesaas");
  assertStringIncludes(html, "I no longer want to receive these notices");
  assert(!ACCENT.test(textOf(html)));
});

Deno.test("en: digest with events, linhas and many posts", () => {
  const ev = { ocorrencia_id: 7, inicio: "2026-10-15T13:00:00Z", fim: "2026-10-15T14:00:00Z", dia_inteiro: false, data_inicio_local: null, tz: "America/New_York", titulo: "Shoot" };
  const html = buildClientEventEmail({
    ...CE,
    pendingPosts: Array.from({ length: 22 }, (_, i) => ({ titulo: `P${i}`, tipo: "feed" })),
    pendingEvents: [ev],
    linhas: [{ periodo: "2026-10-01" }],
  });
  assertStringIncludes(html, "and 2 more posts waiting for approval.");
  assertStringIncludes(html, "Events waiting for your confirmation");
  assertStringIncludes(html, "Thursday, October 15 · 9:00 AM to 10:00 AM");
  assertStringIncludes(html, "Editorial line for October is waiting for your approval");
  const only = buildClientEventEmail({ ...CE, pendingPosts: [], unreadMessages: 0, pendingEvents: [ev] });
  assertStringIncludes(only, "1 event is waiting for your confirmation");
  assertStringIncludes(only, "Hi Mary! Please confirm your attendance at the upcoming events:");
  assertStringIncludes(only, "Confirm attendance");
  assertEquals(linhaItemText("2026-03-01", "  Spring plan ", "en"), "Spring plan is waiting for your approval");
});

// --- en: agenda dates ----------------------------------------------------------

Deno.test("en: agenda date formatting keeps the event's own zone and names it when not the default", () => {
  const base = WHEN_CASES.simples as never;
  assertEquals(formatarQuandoAgenda({ ...(base as object), tz: "America/New_York" } as never, "en"), "Thursday, October 15 · 9:00 AM to 10:00 AM");
  assertEquals(formatarQuandoAgenda({ ...(base as object), tz: "America/Los_Angeles" } as never, "en"), "Thursday, October 15 · 6:00 AM to 7:00 AM (America/Los_Angeles)");
  assertEquals(formatarQuandoAgenda({ ...(base as object), tz: "America/Sao_Paulo" } as never, "en"), "Thursday, October 15 · 10:00 AM to 11:00 AM (America/Sao_Paulo)");
  assertEquals(formatarQuandoAgenda(WHEN_CASES["dia inteiro"] as never, "en"), "Monday, November 2 · all day");
  assertEquals(formatarQuandoAgenda(WHEN_CASES["dia inteiro multi"] as never, "en"), "Monday, November 2 to Wednesday, November 4 · all day");
  assertStringIncludes(formatarQuandoAgenda(WHEN_CASES["multi-day"] as never, "en"), " to Friday, October 16 · ");
  assertEquals(mesDiaAgenda(WHEN_CASES.simples as never, "en"), { mes: "OCT", dia: "15" });
  assertEquals(mesDiaAgenda(WHEN_CASES.simples as never), { mes: "OUT", dia: "15" });
  assertEquals(formatarQuandoAgenda({ ...(base as object), tz: "America/Sao_Paulo" } as never), "Quinta, 15 de outubro · 10:00 a 11:00");
});

// --- en: agenda client / guest e-mail -------------------------------------------

const CTX = { hubUrl: HUB, unsubUrl: `${APP}/unsub/x`, agora: new Date("2026-10-10T12:00:00Z"), lang: "en" as const };

Deno.test("en: agenda invite (client) with .ics", () => {
  const e = montarEmailAgendaCliente(AGENDA_ITEMS.convite, CTX);
  assertEquals(e.subject, "New event: Sessão de fotos");
  assertStringIncludes(e.html, '<html lang="en"');
  assertStringIncludes(e.html, "Hi Clínica Sorriso! Lume".replace("Lume", "Agência Lume shared an event with you."));
  assertStringIncludes(e.html, "To add it to your calendar, open the attached file.");
  assertStringIncludes(e.html, "Confirm attendance");
  assertStringIncludes(e.html, "Location: Av. Paulista, 900");
  assertStringIncludes(e.html, "Organized by Ana Souza");
  assertStringIncludes(e.html, "I no longer want to receive these notices");
  assertEquals(e.attachments.length, 1);
  assertEquals(e.attachments[0].filename, "evento.ics");
  const ics = new TextDecoder().decode(Uint8Array.from(atob(e.attachments[0].content), (c) => c.charCodeAt(0)));
  assertStringIncludes(ics, "PRODID:-//Mesaas//Agenda//EN");
  assertStringIncludes(ics, "BEGIN:VEVENT");
  assertStringIncludes(ics, "DTSTART:20261015T130000Z");
  const withLink = montarEmailAgendaCliente(
    { ...AGENDA_ITEMS.convite, ocorrencias: [{ ...AGENDA_ITEMS.convite.ocorrencias![0], link_reuniao: "https://meet.test/x" }] },
    CTX,
  );
  const ics2 = new TextDecoder().decode(Uint8Array.from(atob(withLink.attachments[0].content), (c) => c.charCodeAt(0)));
  assertStringIncludes(ics2.replace(/\r\n /g, ""), "Meeting link: https://meet.test/x");
  assertStringIncludes(withLink.html, "Join the meeting");
});

Deno.test("en: agenda variants (alteracao, cancelamento, reschedule, guest)", () => {
  const alt = montarEmailAgendaCliente(AGENDA_ITEMS.alteracao, CTX);
  assertEquals(alt.subject, "Event updated: Sessão de fotos");
  assertStringIncludes(alt.html, "Canceled dates");
  assertStringIncludes(alt.html, "If you added this event to your calendar, open the attached file to update it.");
  const can = montarEmailAgendaCliente(AGENDA_ITEMS.cancelamento, CTX);
  assertEquals(can.subject, "Event canceled: Sessão de fotos");
  assertStringIncludes(can.html, "Canceled date");
  assertStringIncludes(can.html, "View in the portal");
  assertStringIncludes(can.html, "If you added this event to your calendar, remove it.");
  const ok = montarEmailAgendaCliente(AGENDA_ITEMS["remarcacao aceita"], CTX);
  assertEquals(ok.subject, "Reschedule accepted: Sessão de fotos");
  assertStringIncludes(ok.html, "accepted your reschedule request. The new time is:");
  assertStringIncludes(ok.html, "Message from the team");
  const no = montarEmailAgendaCliente(AGENDA_ITEMS["remarcacao recusada"], CTX);
  assertEquals(no.subject, "Reschedule not accepted: Sessão de fotos");
  assertStringIncludes(no.html, "could not accept the time you suggested (Friday, October 16 · 10:00 AM (America/Sao_Paulo)).");
  assertStringIncludes(no.html, "The time that still applies:");
  const g = montarEmailAgendaCliente(AGENDA_ITEMS["convidado convite"], { ...CTX, hubUrl: "", botaoUrl: `${APP}/convite/tok` });
  assertEquals(g.subject, "Invitation: Sessão de fotos");
  assertStringIncludes(g.html, "Hi Bia!");
  assertStringIncludes(g.html, "Ana Souza invited you on behalf of Agência Lume.");
  assertStringIncludes(g.html, "Respond to the invitation");
  const anon = montarEmailAgendaCliente(AGENDA_ITEMS["convidado convite sem organizador"], { ...CTX, hubUrl: "", botaoUrl: null });
  assertStringIncludes(anon.html, "Hi! Agência Lume invited you to an event.");
  const serie = montarEmailAgendaCliente(AGENDA_ITEMS["convite serie 12"], CTX);
  assertStringIncludes(serie.html, "and 2 more dates");
});

// --- en: reminder -------------------------------------------------------------

const LB = {
  titulo: "Shoot", inicio: "2026-10-05T17:00:00Z", fim: "2026-10-05T19:00:00Z", diaInteiro: false,
  local: null as string | null, linkReuniao: null as string | null, tz: "America/New_York", minutos: 10,
  abrirUrl: `${APP}/calendario?evento=7`, appBaseUrl: APP, lang: "en" as const,
};

Deno.test("en: reminder subjects by lead time", () => {
  assertEquals(buildLembreteEmail(LB).subject, "In 10 minutes: Shoot");
  assertEquals(buildLembreteEmail({ ...LB, minutos: 1 }).subject, "In 1 minute: Shoot");
  assertEquals(buildLembreteEmail({ ...LB, minutos: 60 }).subject, "In 1 hour: Shoot");
  assertEquals(buildLembreteEmail({ ...LB, minutos: 120 }).subject, "In 2 hours: Shoot");
  assertEquals(buildLembreteEmail({ ...LB, minutos: 1440 }).subject, "Tomorrow: Shoot");
  assertEquals(buildLembreteEmail({ ...LB, minutos: 2880 }).subject, "In 2 days: Shoot");
  assertEquals(buildLembreteEmail({ ...LB, minutos: 0 }).subject, "Starting now: Shoot");
  assertEquals(buildLembreteEmail({ ...LB, diaInteiro: true, minutos: -540 }).subject, "Today: Shoot");
});

Deno.test("en: reminder body", () => {
  const { html } = buildLembreteEmail({ ...LB, minutos: 90, local: "Studio 4", linkReuniao: "https://meet.test/x" });
  assertStringIncludes(html, '<html lang="en"');
  assertStringIncludes(html, "Your event starts in 90 minutes");
  assertStringIncludes(html, "Monday, October 5 · 1:00 PM to 3:00 PM");
  assertStringIncludes(html, "Join the meeting");
  assertStringIncludes(html, "Open in Agenda");
  assertStringIncludes(html, "You are receiving this reminder because you are part of this event.");
  assertStringIncludes(buildLembreteEmail({ ...LB, minutos: 60 }).html, "Your event starts in 1 hour");
  assertStringIncludes(buildLembreteEmail({ ...LB, minutos: 1440 }).html, "Your event starts tomorrow");
  const day = buildLembreteEmail({ ...LB, diaInteiro: true, minutos: 4320, inicio: "2026-11-02T05:00:00Z", fim: "2026-11-03T05:00:00Z" }).html;
  assertStringIncludes(day, "Reminder: Shoot is in 3 days");
  assertStringIncludes(day, "all day");
  assert(!ACCENT.test(textOf(html)));
});

// --- en: hub login code ----------------------------------------------------------

Deno.test("en: hub login code e-mail", () => {
  const { subject, html } = buildLoginCodeEmail({ code: "123456", workspaceName: "Sun <Agency>", brandColor: "#ff6600", logoUrl: null, lang: "en" });
  assertEquals(subject, "Your access code");
  assertStringIncludes(html, '<html lang="en"');
  assertStringIncludes(html, "Use this code to sign in to the Sun &lt;Agency&gt; portal.");
  assertStringIncludes(html, "The code is valid for 10 minutes.");
  assertStringIncludes(html, "If you did not request this code, ignore this email.");
  assertStringIncludes(html, "Sent by Sun &lt;Agency&gt; via Mesaas");
  assert(!subject.includes("123456"));
});

// --- unsubscribe page -------------------------------------------------------------

function unsub(lang?: "pt" | "en", throws = false) {
  return createClientEmailUnsubHandler({
    db: {
      from: () => ({ update: () => ({ eq: () => ({ select: () => Promise.resolve({ data: [{ conta_id: "c" }], error: null }) }) }) }),
    } as never,
    verifyToken: (t) => Promise.resolve(t === "good" ? { tipo: "cliente", id: 1 } : t === "guest" ? { tipo: "convidado", id: 2 } : null),
    descadastrarConvidado: () => Promise.resolve({ conta_id: "c" }),
    targetLang: lang === undefined ? undefined : () => throws ? Promise.reject(new Error("x")) : Promise.resolve(lang),
    tokenSecret: "s",
    now: () => new Date("2026-01-01T00:00:00Z"),
    auditLog: () => Promise.resolve(),
    buildCorsHeaders: () => ({}),
  });
}
const call = (h: ReturnType<typeof unsub>, method: string, token: string) =>
  h(new Request(`https://x.test/functions/v1/client-email-unsub/${token}`, { method })).then(async (r) => ({ status: r.status, body: await r.text() }));

Deno.test("unsubscribe page: en workspace renders English, pt by default and on any failure", async () => {
  const en = await call(unsub("en"), "GET", "good");
  assertEquals(en.status, 200);
  assertStringIncludes(en.body, '<html lang="en">');
  assertStringIncludes(en.body, "Stop receiving these notices?");
  assertStringIncludes(en.body, "pending-item emails from this agency");
  assert(!ACCENT.test(textOf(en.body)));
  assertStringIncludes((await call(unsub("en"), "GET", "guest")).body, "event invitations and notices");
  assertStringIncludes((await call(unsub("en"), "POST", "good")).body, "You will no longer receive these notices.");
  const pt = await call(unsub("pt"), "GET", "good");
  assertStringIncludes(pt.body, '<html lang="pt-BR">');
  assertStringIncludes(pt.body, "Deixar de receber estes avisos?");
  assertStringIncludes((await call(unsub(), "GET", "good")).body, "Deixar de receber estes avisos?");
  assertStringIncludes((await call(unsub("en", true), "POST", "good")).body, "Pronto.");
  const bad = await call(unsub("en"), "GET", "nope");
  assertEquals(bad.status, 404);
  assertStringIncludes(bad.body, "Link inválido");
});
