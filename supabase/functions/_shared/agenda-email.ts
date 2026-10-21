import { sanitizeSubjectValue } from "./lifecycle-emails.ts";
import { mesaasEmail } from "./email/shell.ts";
import { button, eventCard, heading } from "./email/blocks.ts";
import { EMAIL } from "./email/tokens.ts";

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

/** "OUT" / "12" for the date tile, in the event's zone (same basis as whenLine). */
function tileParts(iso: string, tz: string): { mes: string; dia: string } {
  const p = timeParts(iso, tz, { day: "numeric", month: "short" });
  return { mes: (p.month ?? "").replace(".", "").toUpperCase(), dia: p.day ?? "" };
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
  const t = p.titulo;
  if (p.diaInteiro) {
    if (p.minutos <= 0) return `Lembrete: ${t} é hoje`;
    if (p.minutos <= DAY_MIN) return `Lembrete: ${t} é amanhã`;
    return `Lembrete: ${t} é em ${plural(Math.round(p.minutos / DAY_MIN), "dia", "dias")}`;
  }
  if (p.minutos <= 0) return "Seu evento está começando agora";
  if (p.minutos === DAY_MIN) return "Seu evento começa amanhã";
  return `Seu evento começa em ${leadLabel(p.minutos, false).replace(/^Em /, "")}`;
}

export function buildLembreteEmail(p: LembreteEmailParams): { subject: string; html: string } {
  const subject = sanitizeSubjectValue(`${leadLabel(p.minutos, p.diaInteiro)}: ${p.titulo}`);
  const quando = whenLine(p);
  const local = p.local?.trim() || null;
  const { mes, dia } = tileParts(p.inicio, p.tz);
  const html = mesaasEmail({
    preheader: local ? `${quando} · ${local}` : quando,
    eyebrow: "Agenda",
    sections: [
      heading(headingText(p)),
      eventCard({
        mes, dia, tileColor: EMAIL.ink, titulo: p.titulo,
        lines: local ? [quando, local] : [quando],
        meetingUrl: p.linkReuniao,
      }),
      button(p.abrirUrl, "Abrir na Agenda"),
    ],
    footerLines: ["Você recebe este lembrete porque participa deste evento. Para desligar, vá em Configurações, Notificações."],
  });
  return { subject, html };
}
