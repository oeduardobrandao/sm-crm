/**
 * Inputs and renderer for the client-facing e-mail pt-unchanged fixtures
 * (fixtures/client-email-pt.json): client-event digest, Agenda client/guest
 * e-mails (.ics included), Agenda reminder and Hub login code. `renderAll(lang)`
 * returns every render keyed by case. The pt fixtures were captured from the code
 * BEFORE the language change; `lang` is passed as an extra property or argument,
 * which the pre-change code ignored.
 */
import type { Lang } from "../../_shared/i18n/lang.ts";
import {
  buildClientEventEmail,
  clientEventSubject,
  linhaItemText,
} from "../../_shared/client-event-email.ts";
import {
  type AgendaClienteEmailItem,
  type AgendaClienteOcorrencia,
  formatarQuandoAgenda,
  mesDiaAgenda,
  montarEmailAgendaCliente,
} from "../../_shared/agenda-cliente-email.ts";
import { buildLembreteEmail } from "../../_shared/agenda-email.ts";
import { buildLoginCodeEmail } from "../../hub-auth/email.ts";

const APP = "https://app.test";
const HUB = `${APP}/lume/hub/tok`;
const SP = "America/Sao_Paulo";

// deno-lint-ignore no-explicit-any
type Any = any;

const oc = (id: number, iso: string, extra: Partial<AgendaClienteOcorrencia> = {}): AgendaClienteOcorrencia => ({
  ocorrencia_id: id,
  estado: "ativa",
  sequencia: id,
  inicio: iso,
  fim: new Date(new Date(iso).getTime() + 3600_000).toISOString(),
  dia_inteiro: false,
  data_inicio_local: null,
  data_fim_local: null,
  tz: SP,
  titulo: "Sessão de fotos",
  descricao: "Traga 2 trocas de roupa.\nSem salto.",
  local: "Av. Paulista, 900",
  link_reuniao: null,
  ...extra,
});

const ag = (over: Partial<AgendaClienteEmailItem>): AgendaClienteEmailItem => ({
  id: 1,
  versao: 1,
  tipo: "convite",
  conta_id: "c",
  cliente_id: 1,
  ocorrencias: [oc(1, "2026-10-15T13:00:00Z")],
  remarcacao: null,
  cliente_email: "m@x.test",
  cliente_nome: "Clínica Sorriso",
  workspace_nome: "Agência Lume",
  brand_color: "#7c3aed",
  logo_url: null,
  destinatario: "cliente",
  organizador_nome: "Ana Souza",
  ...over,
});

const serie12 = Array.from({ length: 12 }, (_, i) => oc(i + 1, new Date(Date.UTC(2026, 9, 15 + i, 13)).toISOString()));
const cancelada = (id: number, iso: string) => ({ ...oc(id, iso), estado: "cancelada" as const });
const allDay = oc(1, "2026-11-02T04:00:00Z", {
  dia_inteiro: true,
  data_inicio_local: "2026-11-02",
  data_fim_local: "2026-11-03",
  tz: "America/Manaus",
});
const allDayMulti = oc(1, "2026-11-02T04:00:00Z", {
  dia_inteiro: true,
  data_inicio_local: "2026-11-02",
  data_fim_local: "2026-11-05",
  tz: SP,
  link_reuniao: "https://meet.test/x?a=1&b=2",
});
const manaus = oc(1, "2026-10-16T02:30:00Z", { tz: "America/Manaus", link_reuniao: "https://meet.test/y" });
const multiDay = oc(1, "2026-10-15T22:00:00Z", { fim: "2026-10-16T14:00:00Z" });
const remarc = (over: Record<string, unknown>) => ({
  remarcacao_id: 1,
  inicio_sugerido: null,
  fim_sugerido: null,
  mensagem: null,
  resposta_equipe: null,
  ...over,
});
const guest = (over: Partial<AgendaClienteEmailItem>) =>
  ag({
    destinatario: "convidado",
    cliente_id: null,
    cliente_nome: null,
    nome: "Bia",
    email: "b@x.test",
    convidado_id: 3,
    convidado_token: "tok",
    ...over,
  });

export const AGENDA_ITEMS: Record<string, AgendaClienteEmailItem> = {
  convite: ag({}),
  "convite sem organizador": ag({ organizador_nome: null, cliente_nome: null }),
  "convite serie 12": ag({ ocorrencias: serie12 }),
  "convite dia inteiro": ag({ ocorrencias: [allDay] }),
  "convite dia inteiro multi": ag({ ocorrencias: [allDayMulti] }),
  "convite manaus": ag({ ocorrencias: [manaus] }),
  "convite multi-day": ag({ ocorrencias: [multiDay] }),
  "convite workspace hostil": ag({ workspace_nome: `Agência <Lume> & "Cia"`, ocorrencias: [oc(1, "2026-10-15T13:00:00Z", { titulo: "A\nB <x>" })] }),
  "convite sem workspace": ag({ workspace_nome: null }),
  alteracao: ag({ tipo: "alteracao", ocorrencias: [oc(1, "2026-10-15T13:00:00Z"), cancelada(9, "2026-10-20T13:00:00Z")] }),
  "alteracao 12 canceladas": ag({ tipo: "alteracao", ocorrencias: [oc(1, "2026-10-15T13:00:00Z"), ...Array.from({ length: 12 }, (_, i) => cancelada(20 + i, new Date(Date.UTC(2026, 10, 1 + i, 13)).toISOString()))] }),
  cancelamento: ag({ tipo: "cancelamento", ocorrencias: [cancelada(1, "2026-10-15T13:00:00Z")] }),
  "cancelamento 2": ag({ tipo: "cancelamento", ocorrencias: [cancelada(1, "2026-10-15T13:00:00Z"), cancelada(2, "2026-10-16T13:00:00Z")] }),
  "remarcacao aceita": ag({ tipo: "remarcacao_aceita", remarcacao: remarc({ resposta_equipe: "Combinado!\nAté lá." }) }),
  "remarcacao aceita sem msg": ag({ tipo: "remarcacao_aceita", remarcacao: remarc({}) }),
  "remarcacao recusada": ag({ tipo: "remarcacao_recusada", remarcacao: remarc({ inicio_sugerido: "2026-10-16T13:00:00Z", resposta_equipe: "Infelizmente não." }) }),
  "remarcacao recusada manaus": ag({ tipo: "remarcacao_recusada", ocorrencias: [manaus], remarcacao: remarc({ inicio_sugerido: "2026-10-16T13:00:00Z" }) }),
  "remarcacao recusada dia inteiro": ag({ tipo: "remarcacao_recusada", ocorrencias: [allDay], remarcacao: remarc({ inicio_sugerido: "2026-11-09T04:00:00Z" }) }),
  "remarcacao recusada sem sugestao": ag({ tipo: "remarcacao_recusada", remarcacao: remarc({}) }),
  "convidado convite": guest({}),
  "convidado convite sem organizador": guest({ organizador_nome: null, nome: null }),
  "convidado alteracao": guest({ tipo: "alteracao" }),
  "convidado cancelamento": guest({ tipo: "cancelamento", ocorrencias: [cancelada(1, "2026-10-15T13:00:00Z")] }),
};

const CTX_BASE = { unsubUrl: `${APP}/unsub/x`, agora: new Date("2026-10-10T12:00:00Z") };

const EV = { ocorrencia_id: 7, inicio: "2026-10-15T13:00:00Z", fim: "2026-10-15T14:00:00Z", dia_inteiro: false, data_inicio_local: null, tz: SP, titulo: "Sessão" };
const EV_MANAUS = { ...EV, ocorrencia_id: 8, tz: "America/Manaus", inicio: "2026-10-16T02:30:00Z", fim: "2026-10-16T03:30:00Z", titulo: "Live <ao vivo>" };
const EV_ALLDAY = { ...EV, ocorrencia_id: 9, dia_inteiro: true, data_inicio_local: "2026-11-02", inicio: "2026-11-02T03:00:00Z", fim: "2026-11-03T03:00:00Z", titulo: "Feriado" };
const CE_BASE = {
  clienteNome: "Mariana Costa",
  workspaceName: "Agência Lume",
  brandColor: "#7c3aed",
  logoUrl: null,
  pendingPosts: [{ titulo: "Carrossel", tipo: "carrossel" }],
  unreadMessages: 2,
  hubUrl: HUB,
  unsubUrl: `${APP}/unsub/x`,
};
const posts = (n: number) => Array.from({ length: n }, (_, i) => ({ titulo: `Post ${i + 1} <b>`, tipo: ["feed", "reels", "story", "carrossel", "outro"][i % 5] }));
export const CLIENT_EVENT_CASES: Record<string, Record<string, unknown>> = {
  "tudo": { pendingEvents: [EV, EV_MANAUS, EV_ALLDAY], linhas: [{ periodo: "2026-09-01" }], unreadMessages: 1 },
  "1 post": {},
  "3 posts 0 msgs": { pendingPosts: posts(3), unreadMessages: 0 },
  "25 posts": { pendingPosts: posts(25), unreadMessages: 4 },
  "so mensagens 1": { pendingPosts: [], unreadMessages: 1 },
  "so mensagens 3": { pendingPosts: [], unreadMessages: 3 },
  "so eventos 1": { pendingPosts: [], unreadMessages: 0, pendingEvents: [EV] },
  "so eventos 3": { pendingPosts: [], unreadMessages: 0, pendingEvents: [EV, EV_MANAUS, EV_ALLDAY] },
  "eventos e mensagens": { pendingPosts: [], unreadMessages: 2, pendingEvents: [EV] },
  "so linhas 1": { pendingPosts: [], unreadMessages: 0, linhas: [{ periodo: "2026-03-01" }] },
  "so linhas 2": { pendingPosts: [], unreadMessages: 0, linhas: [{ periodo: "2026-12-01" }, { periodo: "2026-01-01", titulo: "Pauta <Verão>" }] },
  "linha periodo ruim": { pendingPosts: [], unreadMessages: 0, linhas: [{ periodo: "???" }] },
  "linha titulo em branco": { pendingPosts: [], unreadMessages: 0, linhas: [{ periodo: "2026-05-01", titulo: "   " }] },
  "posts e linhas": { pendingPosts: posts(2), linhas: [{ periodo: "2026-09-01" }] },
  "nada": { pendingPosts: [], unreadMessages: 0 },
  "sem hub": { hubUrl: "", pendingEvents: [EV] },
  "nome unico": { clienteNome: "Clínica", workspaceName: `Agência <Lume> & "Cia"` },
  "sem hub so msgs": { hubUrl: "", pendingPosts: [], unreadMessages: 2 },
};

export const LEMBRETE_BASE = {
  titulo: "Gravação",
  inicio: "2026-10-05T17:00:00Z",
  fim: "2026-10-05T19:00:00Z",
  diaInteiro: false,
  local: null as string | null,
  linkReuniao: null as string | null,
  tz: SP,
  minutos: 10,
  abrirUrl: `${APP}/calendario?evento=7`,
  appBaseUrl: APP,
};
export const LEMBRETE_CASES: Record<string, Record<string, unknown>> = {
  "10min": {},
  "60min": { minutos: 60 },
  "120min": { minutos: 120 },
  "1440": { minutos: 1440 },
  "2880": { minutos: 2880 },
  "0": { minutos: 0 },
  "-5": { minutos: -5 },
  "1 min": { minutos: 1 },
  "90 min": { minutos: 90 },
  "local e link": { local: "Rua <Augusta> 10", linkReuniao: "https://meet.test/x?a=1&b=2" },
  "dia inteiro hoje": { diaInteiro: true, minutos: -540, inicio: "2026-11-02T03:00:00Z", fim: "2026-11-03T03:00:00Z" },
  "dia inteiro amanha": { diaInteiro: true, minutos: 1440, inicio: "2026-11-02T03:00:00Z", fim: "2026-11-03T03:00:00Z" },
  "dia inteiro 3 dias": { diaInteiro: true, minutos: 4320, inicio: "2026-11-02T03:00:00Z", fim: "2026-11-05T03:00:00Z" },
  "dia inteiro 1 dia mais": { diaInteiro: true, minutos: 1441, inicio: "2026-11-02T03:00:00Z", fim: "2026-11-03T03:00:00Z" },
  "varios dias": { minutos: 60, inicio: "2026-10-05T22:00:00Z", fim: "2026-10-06T14:00:00Z" },
  "utc": { tz: "UTC", minutos: 10 },
  "titulo hostil": { titulo: "L1\r\nBcc: x@y.z" },
};

export const LOGIN_CODE_CASES: Record<string, Record<string, unknown>> = {
  basico: { code: "123456", workspaceName: "Agência <Sol>", brandColor: "#ff6600", logoUrl: null },
  "marca ruim": { code: "654321", workspaceName: "Lume", brandColor: "red;x", logoUrl: "https://cdn.test/logo.png" },
};

export const WHEN_CASES: Record<string, Record<string, unknown>> = {
  simples: EV,
  manaus: EV_MANAUS,
  "dia inteiro": EV_ALLDAY,
  "dia inteiro multi": allDayMulti,
  "multi-day": multiDay,
  utc: { ...EV, tz: "UTC" },
  "tz ruim": { ...EV, tz: "Nowhere/City" },
};

function decode(b64: string): string {
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function renderAll(lang: Lang | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const L = { lang } as Any;
  for (const [k, o] of Object.entries(CLIENT_EVENT_CASES)) {
    out[`ce/${k}`] = buildClientEventEmail({ ...CE_BASE, ...o, ...L } as Any);
  }
  for (const w of ["Agência Lume", "Evil\nName", "x".repeat(200)]) {
    out[`ce-subject/${w.slice(0, 8)}`] = (clientEventSubject as Any)(w, lang);
  }
  for (const [p, t] of [["2026-09-01", undefined], ["2026-12-01", null], ["2026-01-15", "  Pauta  "], ["???", undefined], ["", ""], ["2026-13-01", undefined]] as [string, string | null | undefined][]) {
    out[`linha/${p}/${t}`] = (linhaItemText as Any)(p, t, lang);
  }
  for (const [k, q] of Object.entries(WHEN_CASES)) {
    out[`when/${k}`] = (formatarQuandoAgenda as Any)(q, lang);
    const md = (mesDiaAgenda as Any)(q, lang);
    out[`mesdia/${k}`] = `${md.mes}|${md.dia}`;
  }
  for (const [k, item] of Object.entries(AGENDA_ITEMS)) {
    const ctxs: Record<string, Record<string, unknown>> = {
      hub: { hubUrl: HUB },
      "sem hub": { hubUrl: "" },
      "botao": { hubUrl: "", botaoUrl: `${APP}/convite/tok?ocorrencia=1` },
      "sem botao": { hubUrl: "", botaoUrl: null },
    };
    for (const [ck, c] of Object.entries(ctxs)) {
      const e = montarEmailAgendaCliente(item, { ...CTX_BASE, ...c, ...L } as Any);
      out[`ag/${k}/${ck}/subject`] = e.subject;
      out[`ag/${k}/${ck}/html`] = e.html;
      out[`ag/${k}/${ck}/ics`] = e.attachments.map((a) => `${a.filename}|${a.content_type}|${decode(a.content)}`).join("\n--\n");
    }
  }
  for (const [k, o] of Object.entries(LEMBRETE_CASES)) {
    const e = buildLembreteEmail({ ...LEMBRETE_BASE, ...o, ...L } as Any);
    out[`lembrete/${k}/subject`] = e.subject;
    out[`lembrete/${k}/html`] = e.html;
  }
  for (const [k, o] of Object.entries(LOGIN_CODE_CASES)) {
    const e = buildLoginCodeEmail({ ...o, ...L } as Any);
    out[`login/${k}/subject`] = e.subject;
    out[`login/${k}/html`] = e.html;
  }
  return out;
}
