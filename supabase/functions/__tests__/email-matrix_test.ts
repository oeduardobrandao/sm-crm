import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildThankYouEmail, buildWelcomeEmail } from "../_shared/lifecycle-emails.ts";
import { buildDigestHtml } from "../_shared/notification-email.ts";
import { buildDunningEmail } from "../_shared/dunning-email.ts";
import { buildInviteEmail } from "../_shared/invite-email.ts";
import { buildLembreteEmail } from "../_shared/agenda-email.ts";
import { buildConnectedNoticeEmail, buildConnectLinkEmail } from "../_shared/instagram-connect-email.ts";
import { buildAffiliateLinkEmail } from "../affiliate-public/email.ts";
import { buildClientEventEmail } from "../_shared/client-event-email.ts";
import { montarEmailAgendaCliente } from "../_shared/agenda-cliente-email.ts";
import { buildReportEmail } from "../_shared/report-template/email.ts";

const APP = "https://app.test";
const HUB = "https://app.test/lume/hub/tok";
const tz = "America/Sao_Paulo";
const oc = (id: number, iso: string, extra: Record<string, unknown> = {}) => ({
  ocorrencia_id: id, estado: "ativa", sequencia: id, inicio: iso,
  fim: new Date(new Date(iso).getTime() + 3600_000).toISOString(), dia_inteiro: false,
  data_inicio_local: null, data_fim_local: null, tz, titulo: "Sessão de fotos",
  descricao: "Traga 2 trocas de roupa.", local: "Av. Paulista, 900", link_reuniao: null, ...extra,
});
const ag = (over: Record<string, unknown>) => ({
  id: 1, versao: 1, tipo: "convite", conta_id: "c", cliente_id: 1, ocorrencias: [oc(1, "2026-10-15T13:00:00Z")],
  remarcacao: null, cliente_email: "m@x.test", cliente_nome: "Clínica Sorriso", workspace_nome: "Agência Lume",
  brand_color: "#7c3aed", logo_url: null, destinatario: "cliente", organizador_nome: "Ana Souza", ...over,
  // deno-lint-ignore no-explicit-any
}) as any;
const actx = { hubUrl: HUB, unsubUrl: `${APP}/unsub/x`, agora: new Date("2026-10-10T12:00:00Z") };
const serie = Array.from({ length: 12 }, (_, i) => oc(i + 1, new Date(Date.UTC(2026, 9, 15 + i, 13)).toISOString()));
const cancelada = { ...oc(9, "2026-10-20T13:00:00Z"), estado: "cancelada" };
const ev = { ocorrencia_id: 7, inicio: "2026-10-15T13:00:00Z", fim: "2026-10-15T14:00:00Z", dia_inteiro: false, data_inicio_local: null, tz, titulo: "Sessão" };
const ce = { clienteNome: "Mariana Costa", workspaceName: "Agência Lume", brandColor: "#7c3aed", logoUrl: null, pendingPosts: [{ titulo: "Carrossel", tipo: "carrossel" }], unreadMessages: 2, hubUrl: HUB, unsubUrl: `${APP}/unsub/x`, pendingEvents: [ev] };
const rep = { clientName: "Ana Lima", month: "2026-09", workspaceName: "Agência Lume", brandColor: "#7c3aed", logoUrl: null, aiSummary: "Mês forte.", pdfUrl: `${APP}/r.pdf`, hubUrl: HUB };

const FIXTURES: Record<string, string> = {
  "welcome com nome": buildWelcomeEmail({ firstName: "Ana", appBaseUrl: APP }),
  "welcome sem nome": buildWelcomeEmail({ firstName: null, appBaseUrl: APP }),
  "thank you": buildThankYouEmail({ firstName: "Ana", workspaceName: "Agência Lume", appBaseUrl: APP }),
  "digest 1": buildDigestHtml([{ priority: 1, heading: "Falha ao publicar", link: "/a", badge: { tone: "danger", label: "Falha na publicação" } }], APP),
  "digest 3": buildDigestHtml([
    { priority: 1, heading: "A", link: "/a", badge: { tone: "danger", label: "Falha na publicação" } },
    { priority: 2, heading: "B", body: "Pode trocar a capa?", link: "/b", badge: { tone: "warning", label: "Correção" } },
    { priority: 4, heading: "C", link: "/c" },
  ], APP),
  "dunning first": buildDunningEmail({ stage: "first", workspaceName: "Agência Lume", nextAttemptLabel: "14 de outubro", billingUrl: `${APP}/c` }),
  "dunning retry": buildDunningEmail({ stage: "retry", workspaceName: "Agência Lume", nextAttemptLabel: null, billingUrl: `${APP}/c` }),
  "dunning final": buildDunningEmail({ stage: "final", workspaceName: "Agência Lume", nextAttemptLabel: null, billingUrl: `${APP}/c` }),
  "invite": buildInviteEmail({ actionLink: `${APP}/verify?t=1`, workspaceName: "Agência Lume" }),
  "lembrete hora": buildLembreteEmail({ titulo: "Pauta", inicio: "2026-10-12T17:00:00Z", fim: "2026-10-12T18:00:00Z", diaInteiro: false, local: "Rua Augusta", linkReuniao: "https://meet.test/x", tz, minutos: 60, abrirUrl: `${APP}/agenda`, appBaseUrl: APP }).html,
  "lembrete dia inteiro": buildLembreteEmail({ titulo: "Feriado", inicio: "2026-11-02T03:00:00Z", fim: "2026-11-03T03:00:00Z", diaInteiro: true, local: null, linkReuniao: null, tz, minutos: 1440, abrirUrl: `${APP}/agenda`, appBaseUrl: APP }).html,
  "ig connect": buildConnectLinkEmail({ agencyName: "Agência Lume", clienteName: "Clínica Sorriso", connectUrl: `${APP}/c/abc`, appBaseUrl: APP }),
  "ig connected": buildConnectedNoticeEmail({ clienteName: "Clínica Sorriso", igUsername: "clinica", clienteUrl: `${APP}/clientes/1`, appBaseUrl: APP }),
  "affiliate": buildAffiliateLinkEmail({ nome: "Ana Souza", link: `${APP}/afiliados/painel` }),
  "pendencias tudo": buildClientEventEmail(ce),
  "pendencias so eventos": buildClientEventEmail({ ...ce, pendingPosts: [], unreadMessages: 0 }),
  "pendencias sem hub (defensivo)": buildClientEventEmail({ ...ce, hubUrl: "" }),
  "agenda convite": montarEmailAgendaCliente(ag({}), actx).html,
  "agenda serie 12": montarEmailAgendaCliente(ag({ ocorrencias: serie }), actx).html,
  "agenda alteracao": montarEmailAgendaCliente(ag({ tipo: "alteracao", ocorrencias: [oc(1, "2026-10-15T13:00:00Z"), cancelada] }), actx).html,
  "agenda cancelamento": montarEmailAgendaCliente(ag({ tipo: "cancelamento", ocorrencias: [{ ...oc(1, "2026-10-15T13:00:00Z"), estado: "cancelada" }] }), actx).html,
  "agenda remarcacao aceita": montarEmailAgendaCliente(ag({ tipo: "remarcacao_aceita", remarcacao: { remarcacao_id: 1, inicio_sugerido: null, fim_sugerido: null, mensagem: null, resposta_equipe: "Combinado!" } }), actx).html,
  "agenda remarcacao recusada": montarEmailAgendaCliente(ag({ tipo: "remarcacao_recusada", remarcacao: { remarcacao_id: 1, inicio_sugerido: "2026-10-16T13:00:00Z", fim_sugerido: null, mensagem: null, resposta_equipe: null } }), actx).html,
  "agenda convidado": montarEmailAgendaCliente(ag({ destinatario: "convidado", cliente_id: null, nome: "Bia", email: "b@x.test", convidado_id: 3, convidado_token: "tok" }), { ...actx, botaoUrl: `${APP}/convite/tok` }).html,
  "agenda convidado cancelamento": montarEmailAgendaCliente(ag({ tipo: "cancelamento", destinatario: "convidado", cliente_id: null, nome: "Bia", ocorrencias: [{ ...oc(1, "2026-10-15T13:00:00Z"), estado: "cancelada" }] }), { ...actx, botaoUrl: `${APP}/convite/tok` }).html,
  "agenda dia inteiro": montarEmailAgendaCliente(ag({ ocorrencias: [oc(1, "2026-11-02T04:00:00Z", { dia_inteiro: true, data_inicio_local: "2026-11-02", data_fim_local: "2026-11-03", tz: "America/Manaus" })] }), actx).html,
  "report 3 kpis": buildReportEmail({ ...rep, emailKpis: { views: { value: 48200, pct_change: 18 }, interactions: { value: 1200 }, followers_gained: { value: 87 } } }),
  "report 1 kpi": buildReportEmail({ ...rep, emailKpis: { views: { value: 48200 } } }),
  "report sem kpis": buildReportEmail({ ...rep, emailKpis: null }),
  "report sem hub": buildReportEmail({ ...rep, hubUrl: "", emailKpis: null }),
};

export { FIXTURES };

const OLD_ICONS = /[🖼🗂🎬📱📅💬👥📋✅📈📚]/u;

for (const [name, html] of Object.entries(FIXTURES)) {
  Deno.test(`matrix: ${name}`, () => {
    assert(html.includes(`<meta name="color-scheme" content="light">`), "color-scheme");
    const pre = html.match(/<div style="display:none;[^>]*>([^&<]*)/);
    assert(pre && pre[1].trim().length > 0, "preheader");
    assert(html.includes(`width="560"`), "card width");
    assert(!html.includes("—"), "em-dash in authored copy");
    assert(!OLD_ICONS.test(html), "old emoji icon");
    assert(!html.includes("#1a3d2b") && !html.includes("#f5f3ee"), "old palette");
    assert(!html.includes("gestão inteligente"), "old tagline");
    assert(!/display:\s*(flex|grid)/.test(html), "flex/grid");
  });
}
