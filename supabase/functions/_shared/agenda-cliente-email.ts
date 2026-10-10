/**
 * Client-facing Agenda e-mails (sub-project 3, spec §5/§6): invite, change,
 * cancellation and reschedule outcome, each built ONLY from the immutable
 * snapshot stored in `agenda_emails_cliente` (the series may be gone by the
 * time this runs). Pure: no I/O, no env. The caller (agenda-cliente-email)
 * resolves the Hub URL and signs the unsubscribe link.
 *
 * Visual family mirrors _shared/client-event-email.ts (560px card, workspace
 * brand header band, footer with the one-click unsubscribe link) so both
 * client-facing e-mails read as one system.
 *
 * Must NOT import from client-event-email.ts: that module imports
 * `formatarQuandoAgenda` from here for the digest's reminder section.
 */
import { escapeHtml } from "./report-template/escape.ts";
import { type ResendAttachment, sanitizeSubjectValue } from "./lifecycle-emails.ts";
import { buildBrandHeaderBand, buildPreheader, pickHeaderTextColor } from "./report-template/brand-header.ts";
import { gerarCalendario, type IcsEvento } from "./ics.ts";
import { corSegura, linkSeguro } from "./email/safe.ts";

// ─── Contract types (shapes from the plan's "Shared contracts") ─────────────

export type AgendaClienteTipo =
  | "convite"
  | "alteracao"
  | "cancelamento"
  | "remarcacao_aceita"
  | "remarcacao_recusada";

/** One occurrence snapshot entry, frozen at enqueue time. */
export interface AgendaClienteOcorrencia {
  ocorrencia_id: number;
  estado: "ativa" | "cancelada";
  sequencia: number;
  inicio: string;
  fim: string;
  dia_inteiro: boolean;
  data_inicio_local: string | null;
  /** Exclusive end date for all-day rows (same convention as agenda_feed_eventos). */
  data_fim_local: string | null;
  tz: string;
  titulo: string;
  descricao: string | null;
  local: string | null;
  link_reuniao: string | null;
}

export interface AgendaClienteRemarcacao {
  remarcacao_id: number;
  inicio_sugerido: string | null;
  fim_sugerido: string | null;
  mensagem: string | null;
  resposta_equipe: string | null;
}

export type AgendaDestinatario = "cliente" | "convidado";

/** One row of `agenda_cliente_claim_emails` (plus amendment 15's branding).
 * Sub-project 4 made the queue two-recipient: a row is either for the Hub
 * client (`cliente_id`) or for an external guest (`convidado_id`). */
export interface AgendaClienteEmailItem {
  id: number;
  versao: number;
  tipo: AgendaClienteTipo;
  conta_id: string;
  /** NULL for guest rows. */
  cliente_id: number | null;
  ocorrencias: AgendaClienteOcorrencia[] | null;
  remarcacao: AgendaClienteRemarcacao | null;
  /** Kept for compatibility; NULL for guest rows (use `email`/`nome`). */
  cliente_email: string | null;
  cliente_nome: string | null;
  workspace_nome: string | null;
  brand_color: string | null;
  logo_url: string | null;
  /** Absent only on rows claimed before sub-project 4: treated as "cliente". */
  destinatario?: AgendaDestinatario;
  /** Recipient address and name for either kind (guest `nome` may be NULL). */
  email?: string | null;
  nome?: string | null;
  convidado_id?: number | null;
  /** NULL for clients and for a guest removed since (their `cancelamento`). */
  convidado_token?: string | null;
  /** NULL when the organizer is no longer a member (or the series is gone). */
  organizador_nome?: string | null;
  organizador_email?: string | null;
}

/** "convidado" only when the claim said so; anything else is the client path. */
export function ehConvidado(item: Pick<AgendaClienteEmailItem, "destinatario">): boolean {
  return item.destinatario === "convidado";
}

export interface AgendaClienteEmailCtx {
  /** The client's live Hub URL, or "" (no Hub: e-mail goes out without a button).
   * Ignored when `botaoUrl` is given. */
  hubUrl: string;
  /**
   * Full button destination built by the caller (the guest's invite page,
   * `${APP_BASE_URL}/convite/<token>?ocorrencia=<id>`). `null` = no button.
   * When omitted, the client button is derived from `hubUrl` as before.
   */
  botaoUrl?: string | null;
  /** `${SUPABASE_URL}/functions/v1/client-email-unsub/<signed token>`. */
  unsubUrl: string;
  /** DTSTAMP for the attached calendar. */
  agora: Date;
}

export interface AgendaClienteEmail {
  subject: string;
  html: string;
  attachments: ResendAttachment[];
}

/** Thrown for a non-reschedule item with no occurrences (the claim RPC should
 * have discarded it). `name` is what reaches `ultimo_erro`. */
export class SnapshotVazioError extends Error {
  constructor() {
    super("agenda-cliente-email: snapshot sem ocorrências");
    this.name = "SnapshotVazioError";
  }
}

// ─── Date/time formatting in the occurrence's own time zone ──────────────────

const TZ_PADRAO = "America/Sao_Paulo";
const DIAS_LISTADOS = 10;

/** An unknown IANA name makes Intl throw; fall back rather than fail the send. */
function tzSegura(tz: string | null | undefined): string {
  if (!tz) return TZ_PADRAO;
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: tz });
    return tz;
  } catch {
    return TZ_PADRAO;
  }
}

function partes(d: Date, tz: string, opts: Intl.DateTimeFormatOptions): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("pt-BR", { timeZone: tz, hourCycle: "h23", ...opts }).formatToParts(d)) {
    out[p.type] = p.value;
  }
  return out;
}

/** "Quinta, 9 de outubro". */
function rotuloDia(d: Date, tz: string): string {
  const p = partes(d, tz, { weekday: "long", day: "numeric", month: "long" });
  const dia = (p.weekday ?? "").replace(/-feira$/, "");
  return `${dia.charAt(0).toUpperCase()}${dia.slice(1)}, ${p.day} de ${p.month}`;
}

function relogio(d: Date, tz: string): string {
  const p = partes(d, tz, { hour: "2-digit", minute: "2-digit" });
  return `${p.hour}:${p.minute}`;
}

function ymd(d: Date, tz: string): string {
  const p = partes(d, tz, { year: "numeric", month: "2-digit", day: "2-digit" });
  return `${p.year}-${p.month}-${p.day}`;
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A local calendar date as a Date that formats to that same day in UTC. */
function dataLocal(ymdStr: string): Date {
  return new Date(`${ymdStr}T12:00:00Z`);
}

function menosUmDia(ymdStr: string): string {
  const d = dataLocal(ymdStr);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export interface QuandoAgenda {
  inicio: string;
  fim: string;
  dia_inteiro: boolean;
  data_inicio_local?: string | null;
  /** Exclusive end date; derived from `fim` in `tz` when absent. */
  data_fim_local?: string | null;
  tz: string;
}

/**
 * "Quinta, 9 de outubro · 14:00 a 15:00", in the event's own time zone, with
 * " (America/Manaus)" appended when the zone differs from America/Sao_Paulo.
 * All-day: "Quinta, 9 de outubro · dia inteiro" (dates carry no zone).
 * Returns raw text; callers escape it for HTML.
 */
export function formatarQuandoAgenda(q: QuandoAgenda): string {
  const tz = tzSegura(q.tz);
  if (q.dia_inteiro) {
    const primeiro = q.data_inicio_local && YMD_RE.test(q.data_inicio_local)
      ? q.data_inicio_local
      : ymd(new Date(q.inicio), tz);
    const ultimo = q.data_fim_local && YMD_RE.test(q.data_fim_local)
      ? menosUmDia(q.data_fim_local)
      : ymd(new Date(new Date(q.fim).getTime() - 1), tz);
    const rotuloPrimeiro = rotuloDia(dataLocal(primeiro), "UTC");
    if (ultimo <= primeiro) return `${rotuloPrimeiro} · dia inteiro`;
    return `${rotuloPrimeiro} a ${rotuloDia(dataLocal(ultimo), "UTC")} · dia inteiro`;
  }
  const inicio = new Date(q.inicio);
  const fim = new Date(q.fim);
  const sufixo = tz === TZ_PADRAO ? "" : ` (${tz})`;
  const comeco = `${rotuloDia(inicio, tz)} · ${relogio(inicio, tz)}`;
  if (ymd(inicio, tz) === ymd(fim, tz)) return `${comeco} a ${relogio(fim, tz)}${sufixo}`;
  return `${comeco} a ${rotuloDia(fim, tz)} · ${relogio(fim, tz)}${sufixo}`;
}

/** A suggested start alone (no end): "Quinta, 9 de outubro · 14:00". */
function formatarInicioSugerido(iso: string, diaInteiro: boolean, tzBruta: string): string {
  const tz = tzSegura(tzBruta);
  const d = new Date(iso);
  if (diaInteiro) return rotuloDia(d, tz);
  const sufixo = tz === TZ_PADRAO ? "" : ` (${tz})`;
  return `${rotuloDia(d, tz)} · ${relogio(d, tz)}${sufixo}`;
}

// ─── .ics attachment ──────────────────────────────────────────────────────────

/** Standard base64 of the UTF-8 bytes. `btoa(str)` alone would encode Latin-1
 * code units (mangling "ç") and throw on anything outside it (emoji). */
export function base64Utf8(texto: string): string {
  let bin = "";
  for (const b of new TextEncoder().encode(texto)) bin += String.fromCharCode(b);
  return btoa(bin);
}

function paraIcs(o: AgendaClienteOcorrencia): IcsEvento {
  const tz = tzSegura(o.tz);
  const dataInicio = o.data_inicio_local && YMD_RE.test(o.data_inicio_local)
    ? o.data_inicio_local
    : ymd(new Date(o.inicio), tz);
  const dataFim = o.data_fim_local && YMD_RE.test(o.data_fim_local)
    ? o.data_fim_local
    : ymd(new Date(o.fim), tz);
  return {
    uid: `agenda-oc-${o.ocorrencia_id}@mesaas.com.br`,
    inicio: new Date(o.inicio),
    fim: new Date(o.fim),
    diaInteiro: o.dia_inteiro,
    dataInicio,
    dataFim,
    titulo: o.titulo,
    descricao: o.descricao,
    local: o.local,
    url: o.link_reuniao,
    sequencia: o.sequencia,
  };
}

// ─── HTML pieces ───────────────────────────────────────────────────────────────

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

function paragrafo(html: string, estilo = "margin: 0 0 16px; font-size: 15px; line-height: 1.5; color: #4b5563;"): string {
  return `<p style="${estilo}">${html}</p>`;
}

/** Details card for the first active occurrence plus, for a series, the list
 * of its dates (up to DIAS_LISTADOS, then "e mais N datas"). */
function cartaoEvento(ativas: AgendaClienteOcorrencia[]): string {
  const base = ativas[0];
  const local = base.local?.trim()
    ? `<p style="margin: 6px 0 0; font-size: 13px; color: #4b5563;">Local: ${escapeHtml(base.local.trim())}</p>`
    : "";
  const link = linkSeguro(base.link_reuniao);
  const reuniao = link
    ? `<p style="margin: 8px 0 0;"><a href="${
      escapeHtml(link)
    }" style="color: #111827; font-weight: 600; font-size: 13px; text-decoration: underline;">Entrar na reunião</a></p>`
    : "";
  const descricao = base.descricao?.trim()
    ? `<p style="margin: 10px 0 0; font-size: 13px; line-height: 1.5; color: #4b5563; white-space: pre-line;">${
      escapeHtml(base.descricao.trim())
    }</p>`
    : "";

  let quando: string;
  if (ativas.length === 1) {
    quando = `<p style="margin: 6px 0 0; font-size: 14px; color: #374151;">${escapeHtml(formatarQuandoAgenda(base))}</p>`;
  } else {
    const visiveis = ativas.slice(0, DIAS_LISTADOS);
    const resto = ativas.length - visiveis.length;
    const linhas = visiveis.map((o) => {
      const outroTitulo = o.titulo !== base.titulo ? `${escapeHtml(o.titulo)}: ` : "";
      return `<li style="margin: 0 0 4px;">${outroTitulo}${escapeHtml(formatarQuandoAgenda(o))}</li>`;
    }).join("");
    const mais = resto > 0
      ? `<p style="margin: 4px 0 0; font-size: 13px; color: #6b7280;">e mais ${plural(resto, "data", "datas")}</p>`
      : "";
    quando = `<ul style="margin: 8px 0 0; padding: 0 0 0 18px; font-size: 14px; color: #374151;">${linhas}</ul>${mais}`;
  }

  return `<tr><td style="padding: 0 30px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f8f9fa; border-radius: 8px;">
    <tr><td style="padding: 16px 18px;">
      <p style="margin: 0; font-size: 16px; font-weight: 700; color: #111827;">${escapeHtml(base.titulo)}</p>
      ${quando}${local}${reuniao}${descricao}
    </td></tr>
  </table>
</td></tr>`;
}

/** Struck-through list of cancelled dates (up to DIAS_LISTADOS). */
function listaCanceladas(canceladas: AgendaClienteOcorrencia[], rotulo: string): string {
  const visiveis = canceladas.slice(0, DIAS_LISTADOS);
  const resto = canceladas.length - visiveis.length;
  const linhas = visiveis.map((o) =>
    `<li style="margin: 0 0 4px;"><span style="text-decoration: line-through;">${escapeHtml(o.titulo)}: ${
      escapeHtml(formatarQuandoAgenda(o))
    }</span></li>`
  ).join("");
  const mais = resto > 0
    ? `<p style="margin: 4px 0 0; font-size: 13px; color: #6b7280;">e mais ${plural(resto, "data", "datas")}</p>`
    : "";
  return `<tr><td style="padding: 0 30px 16px;">
  <p style="margin: 0 0 6px; font-size: 13px; font-weight: 600; color: #374151;">${rotulo}</p>
  <ul style="margin: 0; padding: 0 0 0 18px; font-size: 14px; color: #6b7280;">${linhas}</ul>${mais}
</td></tr>`;
}

function citacao(rotulo: string, texto: string): string {
  return `<tr><td style="padding: 0 30px 16px;">
  <p style="margin: 0 0 6px; font-size: 13px; font-weight: 600; color: #374151;">${rotulo}</p>
  <p style="margin: 0; padding: 10px 12px; background: #f8f9fa; border-left: 3px solid #d1d5db; font-size: 14px; line-height: 1.5; color: #374151; white-space: pre-line;">${
    escapeHtml(texto)
  }</p>
</td></tr>`;
}

function linha(html: string): string {
  return `<tr><td style="padding: 0 30px;">${html}</td></tr>`;
}

// ─── Builder ──────────────────────────────────────────────────────────────────

export const AGENDA_CLIENTE_ASSUNTOS = {
  convite: "Novo evento: ",
  alteracao: "Evento atualizado: ",
  cancelamento: "Evento cancelado: ",
  remarcacao_aceita: "Remarcação aceita: ",
  remarcacao_recusada: "Remarcação não aceita: ",
} as const;

/** Guest invite subject: the guest has no relationship with the workspace yet. */
export const ASSUNTO_CONVITE_CONVIDADO = "Convite: ";

export const AVISO_CANCELAMENTO = "Se você adicionou este evento ao seu calendário, remova-o.";
export const AVISO_ALTERACAO =
  "Se você adicionou este evento ao seu calendário, abra o arquivo anexo para atualizá-lo.";

type Variante = keyof typeof AGENDA_CLIENTE_ASSUNTOS;

/** E-mail kind decided at send time from the snapshot (spec §5). */
export function varianteAgendaCliente(item: Pick<AgendaClienteEmailItem, "tipo" | "ocorrencias">): Variante {
  if (item.tipo === "remarcacao_aceita" || item.tipo === "remarcacao_recusada") return item.tipo;
  const ocorrencias = item.ocorrencias ?? [];
  if (ocorrencias.every((o) => o.estado === "cancelada")) return "cancelamento";
  if (item.tipo === "convite") return "convite";
  return "alteracao";
}

export function montarEmailAgendaCliente(
  item: AgendaClienteEmailItem,
  ctx: AgendaClienteEmailCtx,
): AgendaClienteEmail {
  const ocorrencias = item.ocorrencias ?? [];
  const ehRemarcacao = item.tipo === "remarcacao_aceita" || item.tipo === "remarcacao_recusada";
  if (ocorrencias.length === 0 && !ehRemarcacao) throw new SnapshotVazioError();

  const variante = varianteAgendaCliente(item);
  const ativas = ocorrencias.filter((o) => o.estado === "ativa");
  const canceladas = ocorrencias.filter((o) => o.estado === "cancelada");
  const principal = ativas[0] ?? ocorrencias[0] ?? null;
  const titulo = principal?.titulo?.trim() || "Evento";

  const convidado = ehConvidado(item);
  const workspaceName = item.workspace_nome?.trim() || "Mesaas";
  const safeWorkspace = escapeHtml(workspaceName);
  const brandColor = corSegura(item.brand_color);
  // Full name, like the digest: clientes are usually businesses ("Clínica
  // Sorriso"), so a first-word greeting reads "Olá, Clínica!". A guest's name
  // is optional (the team may only have typed the e-mail).
  const nome = ((convidado ? item.nome : item.cliente_nome ?? item.nome) ?? "").trim();
  const saudacao = nome ? `Olá, ${escapeHtml(nome)}!` : "Olá!";
  const organizador = item.organizador_nome?.trim() || null;

  const prefixoAssunto = convidado && variante === "convite"
    ? ASSUNTO_CONVITE_CONVIDADO
    : AGENDA_CLIENTE_ASSUNTOS[variante];
  const subject = `${prefixoAssunto}${sanitizeSubjectValue(titulo)}`;

  const remarcacao = item.remarcacao;
  const respostaEquipe = remarcacao?.resposta_equipe?.trim() || null;

  let h1 = "";
  let preheader = "";
  const secoes: string[] = [];
  let aviso: string | null = null;

  switch (variante) {
    case "convite": {
      if (convidado) {
        // Guest copy (spec §3.6): no Hub, the organizer invites on the workspace's behalf.
        h1 = "Convite";
        const frase = organizador
          ? `${organizador} convidou você em nome de ${workspaceName}.`
          : `${workspaceName} convidou você para um evento.`;
        preheader = frase;
        const fraseHtml = organizador
          ? `${escapeHtml(organizador)} convidou você em nome de ${safeWorkspace}.`
          : `${safeWorkspace} convidou você para um evento.`;
        secoes.push(linha(paragrafo(`${saudacao} ${fraseHtml}`)));
      } else {
        h1 = "Novo evento";
        preheader = `${workspaceName} compartilhou um evento com você.`;
        secoes.push(linha(paragrafo(`${saudacao} ${safeWorkspace} compartilhou um evento com você.`)));
      }
      if (ativas.length > 0) secoes.push(cartaoEvento(ativas));
      aviso = "Para adicionar ao seu calendário, abra o arquivo anexo.";
      break;
    }
    case "alteracao": {
      h1 = "Evento atualizado";
      preheader = `${workspaceName} atualizou um evento.`;
      secoes.push(linha(paragrafo(`${saudacao} ${safeWorkspace} atualizou um evento.`)));
      if (ativas.length > 0) secoes.push(cartaoEvento(ativas));
      if (canceladas.length > 0) secoes.push(listaCanceladas(canceladas, "Datas canceladas"));
      aviso = AVISO_ALTERACAO;
      break;
    }
    case "cancelamento": {
      h1 = "Evento cancelado";
      preheader = `${workspaceName} cancelou um evento.`;
      secoes.push(linha(paragrafo(`${saudacao} ${safeWorkspace} cancelou um evento.`)));
      secoes.push(listaCanceladas(canceladas, canceladas.length === 1 ? "Data cancelada" : "Datas canceladas"));
      aviso = AVISO_CANCELAMENTO;
      break;
    }
    case "remarcacao_aceita": {
      h1 = "Remarcação aceita";
      preheader = `${workspaceName} aceitou seu pedido de remarcação.`;
      secoes.push(linha(paragrafo(
        `${saudacao} ${safeWorkspace} aceitou seu pedido de remarcação.${ativas.length > 0 ? " O novo horário é:" : ""}`,
      )));
      if (ativas.length > 0) secoes.push(cartaoEvento(ativas));
      if (respostaEquipe) secoes.push(citacao("Mensagem da equipe", respostaEquipe));
      if (ativas.length > 0) aviso = AVISO_ALTERACAO;
      break;
    }
    case "remarcacao_recusada": {
      h1 = "Remarcação não aceita";
      preheader = `${workspaceName} não pôde aceitar o horário que você sugeriu.`;
      const sugerido = remarcacao?.inicio_sugerido
        ? ` (${
          escapeHtml(
            formatarInicioSugerido(
              remarcacao.inicio_sugerido,
              principal?.dia_inteiro ?? false,
              principal?.tz ?? TZ_PADRAO,
            ),
          )
        })`
        : "";
      secoes.push(linha(paragrafo(
        `${saudacao} ${safeWorkspace} não pôde aceitar o horário que você sugeriu${sugerido}.`,
      )));
      if (respostaEquipe) secoes.push(citacao("Mensagem da equipe", respostaEquipe));
      if (ativas.length > 0) {
        secoes.push(linha(paragrafo("O horário que continua valendo:", "margin: 0 0 8px; font-size: 14px; color: #374151;")));
        secoes.push(cartaoEvento(ativas));
      }
      break;
    }
  }

  // Attach iff something is still on the calendar, except a refused
  // reschedule (nothing changed there, the portal button covers it).
  const anexar = ativas.length > 0 && variante !== "remarcacao_recusada";
  const attachments: ResendAttachment[] = anexar
    ? [{
      filename: "evento.ics",
      content: base64Utf8(gerarCalendario({ nome: workspaceName, eventos: ativas.map(paraIcs), agora: ctx.agora })),
      content_type: "text/calendar; charset=utf-8",
    }]
    : [];

  const confirmar = variante === "convite" || variante === "alteracao";
  let destino: string | null;
  let rotuloBotao: string;
  if (convidado) {
    // A guest has nothing to answer on a cancellation (spec §3.6: no button).
    destino = variante === "cancelamento" ? null : linkSeguro(ctx.botaoUrl ?? null);
    rotuloBotao = "Responder ao convite";
  } else if (ctx.botaoUrl !== undefined) {
    destino = linkSeguro(ctx.botaoUrl);
    rotuloBotao = confirmar ? "Confirmar presença" : "Ver no portal";
  } else {
    const hubBase = ctx.hubUrl.replace(/\/+$/, "");
    destino = !hubBase
      ? null
      : ativas.length > 0
      ? `${hubBase}/agenda?ocorrencia=${ativas[0].ocorrencia_id}`
      : `${hubBase}/agenda`;
    rotuloBotao = confirmar ? "Confirmar presença" : "Ver no portal";
  }
  const botao = destino
    ? `<a href="${escapeHtml(destino)}" style="display: inline-block; background: ${brandColor}; color: ${
      pickHeaderTextColor(brandColor)
    }; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-size: 14px; font-weight: 600;">${rotuloBotao}</a>`
    : "";

  const avisoHtml = aviso
    ? linha(paragrafo(aviso, "margin: 0 0 8px; font-size: 13px; line-height: 1.5; color: #6b7280;"))
    : "";

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; background: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
${buildPreheader(preheader)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f3f4f6; padding: 40px 20px;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
${buildBrandHeaderBand({ workspaceName, brandColor, logoUrl: item.logo_url ?? null })}
<tr><td style="padding: 24px 30px 0;">
  <h1 style="margin: 0 0 12px; font-size: 22px; font-weight: 700; color: #111827;">${h1}</h1>
</td></tr>
${secoes.join("\n")}
${avisoHtml}
<tr><td align="center" style="padding: 16px 30px 30px;">
  ${botao}
</td></tr>
<tr><td style="padding: 20px 30px; background: #f5f3ee; text-align: center;">
  <p style="margin: 0 0 8px; font-size: 12px; color: #888780;">Enviado por ${safeWorkspace} via Mesaas</p>
  <p style="margin: 0; font-size: 12px; color: #888780;"><a href="${
    escapeHtml(ctx.unsubUrl)
  }" style="color: #888780;">Não quero mais receber esses avisos</a></p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject, html, attachments };
}
