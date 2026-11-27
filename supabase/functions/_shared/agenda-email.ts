import { sanitizeSubjectValue } from "./lifecycle-emails.ts";
import { mesaasEmail } from "./email/shell.ts";
import { button, eventCard, heading } from "./email/blocks.ts";
import { EMAIL } from "./email/tokens.ts";
import type { Lang } from "./i18n/lang.ts";
import { agendaText } from "./i18n/catalogs/agenda.ts";
import { mesDiaTile, relogio, rotuloDia, ymd as ymdIn } from "./agenda-cliente-email.ts";

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
  /** Language the reminder is written in (the event's workspace language). */
  lang: Lang;
}

const DAY_MIN = 1440;

/** Lead time as a phrase: "Em 10 minutos", "Em 1 hora", "Amanhã", "Hoje", "Começando agora". */
function leadLabel(minutos: number, diaInteiro: boolean, lang: Lang): string {
  const t = agendaText(lang);
  if (diaInteiro) {
    if (minutos <= 0) return t.leadToday;
    if (minutos <= DAY_MIN) return t.leadTomorrow;
    return t.leadDays(Math.round(minutos / DAY_MIN));
  }
  if (minutos <= 0) return t.leadNow;
  if (minutos === DAY_MIN) return t.leadTomorrow;
  if (minutos % DAY_MIN === 0) return t.leadDays(minutos / DAY_MIN);
  if (minutos >= 60 && minutos % 60 === 0) return t.leadHours(minutos / 60);
  return t.leadMinutes(minutos);
}

const ymd = (iso: string, tz: string) => ymdIn(new Date(iso), tz);

/** "Segunda, 5 de outubro · 14:00 a 16:00" in the event's own timezone. */
function whenLine(p: LembreteEmailParams): string {
  const t = agendaText(p.lang);
  const dayLabel = (iso: string) => rotuloDia(new Date(iso), p.tz, p.lang);
  const clock = (iso: string) => relogio(new Date(iso), p.tz, p.lang);
  if (p.diaInteiro) {
    // fim is exclusive (midnight after the last day).
    const lastDay = new Date(new Date(p.fim).getTime() - 1).toISOString();
    const first = dayLabel(p.inicio);
    if (ymd(p.inicio, p.tz) === ymd(lastDay, p.tz)) return `${first} · ${t.allDay}`;
    return `${first}${t.rangeTo}${dayLabel(lastDay)} · ${t.allDay}`;
  }
  const start = `${dayLabel(p.inicio)} · ${clock(p.inicio)}`;
  if (ymd(p.inicio, p.tz) === ymd(p.fim, p.tz)) return `${start}${t.rangeTo}${clock(p.fim)}`;
  return `${start}${t.rangeTo}${dayLabel(p.fim)} · ${clock(p.fim)}`;
}

function headingText(p: LembreteEmailParams): string {
  const t = agendaText(p.lang);
  const title = p.titulo;
  if (p.diaInteiro) {
    if (p.minutos <= 0) return t.headingTodayAllDay(title);
    if (p.minutos <= DAY_MIN) return t.headingTomorrowAllDay(title);
    return t.headingDaysAllDay(title, Math.round(p.minutos / DAY_MIN));
  }
  if (p.minutos <= 0) return t.headingNow;
  if (p.minutos === DAY_MIN) return t.headingTomorrow;
  return t.headingStartsIn(leadLabel(p.minutos, false, p.lang).replace(/^(Em|In) /, ""));
}

export function buildLembreteEmail(p: LembreteEmailParams): { subject: string; html: string } {
  const t = agendaText(p.lang);
  const subject = sanitizeSubjectValue(`${leadLabel(p.minutos, p.diaInteiro, p.lang)}: ${p.titulo}`);
  const quando = whenLine(p);
  const local = p.local?.trim() || null;
  const { mes, dia } = mesDiaTile(new Date(p.inicio), p.tz, p.lang);
  const html = mesaasEmail({
    preheader: local ? `${quando} · ${local}` : quando,
    eyebrow: t.reminderEyebrow,
    sections: [
      heading(headingText(p)),
      eventCard({
        mes, dia, tileColor: EMAIL.ink, titulo: p.titulo,
        lines: local ? [quando, local] : [quando],
        meetingUrl: p.linkReuniao,
        lang: p.lang,
      }),
      button(p.abrirUrl, t.reminderCta),
    ],
    footerLines: [t.reminderFooter],
    lang: p.lang,
  });
  return { subject, html };
}
