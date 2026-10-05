import { escapeHtml } from "./report-template/escape.ts";
import { layout, sanitizeSubjectValue } from "./lifecycle-emails.ts";

export interface LembreteEmailParams {
  titulo: string;
  inicio: string;
  fim: string;
  diaInteiro: boolean;
  local: string | null;
  linkReuniao: string | null;
  tz: string;
  minutos: number;
  abrirUrl: string;
  appBaseUrl: string;
}

const DAY_MIN = 1440;

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Lead time as a phrase: "Em 10 minutos", "Em 1 hora", "Amanhã", "Hoje", "Começando agora". */
function leadLabel(minutos: number, diaInteiro: boolean): string {
  if (diaInteiro) {
    if (minutos <= 0) return "Hoje";
    if (minutos <= DAY_MIN) return "Amanhã";
    return `Em ${plural(Math.round(minutos / DAY_MIN), "dia", "dias")}`;
  }
  if (minutos <= 0) return "Começando agora";
  if (minutos === DAY_MIN) return "Amanhã";
  if (minutos % DAY_MIN === 0) return `Em ${plural(minutos / DAY_MIN, "dia", "dias")}`;
  if (minutos >= 60 && minutos % 60 === 0) return `Em ${plural(minutos / 60, "hora", "horas")}`;
  return `Em ${plural(minutos, "minuto", "minutos")}`;
}

function timeParts(iso: string, tz: string, opts: Intl.DateTimeFormatOptions): Record<string, string> {
  const parts = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, hourCycle: "h23", ...opts }).formatToParts(new Date(iso));
  const out: Record<string, string> = {};
  for (const p of parts) out[p.type] = p.value;
  return out;
}

function dayLabel(iso: string, tz: string): string {
  const p = timeParts(iso, tz, { weekday: "long", day: "numeric", month: "long" });
  const weekday = (p.weekday ?? "").replace(/-feira$/, "");
  const cap = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  return `${cap}, ${p.day} de ${p.month}`;
}

function clock(iso: string, tz: string): string {
  const p = timeParts(iso, tz, { hour: "2-digit", minute: "2-digit" });
  return `${p.hour}:${p.minute}`;
}

function ymd(iso: string, tz: string): string {
  const p = timeParts(iso, tz, { year: "numeric", month: "2-digit", day: "2-digit" });
  return `${p.year}-${p.month}-${p.day}`;
}

/** "Segunda, 5 de outubro · 14:00 a 16:00" in the event's own timezone. */
function whenLine(p: LembreteEmailParams): string {
  if (p.diaInteiro) {
    // fim is exclusive (midnight after the last day).
    const lastDay = new Date(new Date(p.fim).getTime() - 1).toISOString();
    const first = dayLabel(p.inicio, p.tz);
    if (ymd(p.inicio, p.tz) === ymd(lastDay, p.tz)) return `${first} · dia inteiro`;
    return `${first} a ${dayLabel(lastDay, p.tz)} · dia inteiro`;
  }
  const start = `${dayLabel(p.inicio, p.tz)} · ${clock(p.inicio, p.tz)}`;
  if (ymd(p.inicio, p.tz) === ymd(p.fim, p.tz)) return `${start} a ${clock(p.fim, p.tz)}`;
  return `${start} a ${dayLabel(p.fim, p.tz)} · ${clock(p.fim, p.tz)}`;
}

function headingText(p: LembreteEmailParams): string {
  const t = escapeHtml(p.titulo);
  if (p.diaInteiro) {
    if (p.minutos <= 0) return `Lembrete: ${t} é hoje`;
    if (p.minutos <= DAY_MIN) return `Lembrete: ${t} é amanhã`;
    return `Lembrete: ${t} é em ${plural(Math.round(p.minutos / DAY_MIN), "dia", "dias")}`;
  }
  if (p.minutos <= 0) return "Seu evento está começando agora";
  if (p.minutos === DAY_MIN) return "Seu evento começa amanhã";
  return `Seu evento começa em ${leadLabel(p.minutos, false).replace(/^Em /, "")}`;
}

const HTTP_URL = /^https?:\/\//i;

export function buildLembreteEmail(p: LembreteEmailParams): { subject: string; html: string } {
  const subject = sanitizeSubjectValue(`${leadLabel(p.minutos, p.diaInteiro)}: ${p.titulo}`);

  const local = p.local
    ? `<p style="margin:6px 0 0;font-size:13px;color:#444441">${escapeHtml(p.local)}</p>`
    : "";
  const meeting = p.linkReuniao && HTTP_URL.test(p.linkReuniao.trim())
    ? `<p style="margin:8px 0 0"><a href="${escapeHtml(p.linkReuniao.trim())}" style="color:#1a3d2b;font-weight:700;font-size:13px;text-decoration:underline">Entrar na reunião</a></p>`
    : "";

  const body = `
        <p style="margin:0 0 16px;font-size:18px;font-weight:700;color:#1a3d2b;line-height:1.4">${headingText(p)}</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ee;border-radius:12px"><tr><td style="padding:16px 18px">
          <p style="margin:0;font-size:15px;font-weight:700;color:#1a3d2b">${escapeHtml(p.titulo)}</p>
          <p style="margin:6px 0 0;font-size:13px;color:#444441">${escapeHtml(whenLine(p))}</p>
          ${local}${meeting}
        </td></tr></table>
        <p style="margin:22px 0 0"><a href="${escapeHtml(p.abrirUrl)}" style="display:inline-block;background:#1a3d2b;color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:700;font-size:13px">Abrir na agenda</a></p>`;

  const html = layout(
    body,
    "Você recebe este lembrete porque participa deste evento. Para desligar, vá em Configurações, Notificações.",
    escapeHtml(p.appBaseUrl),
  );
  return { subject, html };
}
