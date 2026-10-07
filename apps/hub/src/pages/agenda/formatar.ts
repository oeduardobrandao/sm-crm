import type { HubAgendaItem } from '../../types';

/**
 * Pure date/time helpers for the Hub Agenda. Every instant is shown in the
 * occurrence's own `tz`, never the browser zone: a client in another state
 * still sees the time the team scheduled. Nothing here reads local Date
 * getters (getHours, toLocaleTimeString without timeZone).
 */

export const FUSO_PADRAO = 'America/Sao_Paulo';

const pad = (n: number) => String(n).padStart(2, '0');

const partesCache = new Map<string, Intl.DateTimeFormat>();

function partesFormatter(tz: string): Intl.DateTimeFormat {
  let f = partesCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    partesCache.set(tz, f);
  }
  return f;
}

export interface Parede {
  /** YYYY-MM-DD in tz. */
  data: string;
  /** HH:MM (24 h) in tz. */
  hora: string;
}

/** Instant -> wall clock in tz (mirrors the CRM's paredeNoFuso). */
export function paredeNoFuso(instante: Date | string, tz: string): Parede {
  const d = typeof instante === 'string' ? new Date(instante) : instante;
  const p: Record<string, number> = {};
  for (const part of partesFormatter(tz).formatToParts(d)) {
    if (part.type !== 'literal') p[part.type] = parseInt(part.value, 10);
  }
  // Some ICU builds still print "24" at midnight.
  const h = p.hour % 24;
  return { data: `${p.year}-${pad(p.month)}-${pad(p.day)}`, hora: `${pad(h)}:${pad(p.minute)}` };
}

/** YYYY-MM-DD -> a Date at UTC midnight, formatted with timeZone UTC so the day never shifts. */
function diaUtc(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map((s) => parseInt(s, 10));
  return new Date(Date.UTC(y, m - 1, d));
}

/** YYYY-MM-DD plus `dias` (may be negative). */
export function somarDias(ymd: string, dias: number): string {
  const d = diaUtc(ymd);
  d.setUTCDate(d.getUTCDate() + dias);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** The local day an occurrence starts on, in its tz. */
export function diaLocal(item: HubAgendaItem): string {
  return item.dia_inteiro ? item.data_inicio_local : paredeNoFuso(item.inicio, item.tz).data;
}

/** Last day of an occurrence (inclusive), in its tz. All-day ends are exclusive in the data. */
export function ultimoDiaLocal(item: HubAgendaItem): string {
  if (item.dia_inteiro) {
    const ultimo = somarDias(item.data_fim_local, -1);
    return ultimo < item.data_inicio_local ? item.data_inicio_local : ultimo;
  }
  return paredeNoFuso(item.fim, item.tz).data;
}

/** Day heading: "quinta-feira, 9 de outubro" / "Thursday, October 9". */
export function formatarDiaTitulo(ymd: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(diaUtc(ymd));
}

/** Short day: "qui., 9 de out." / "Thu, Oct 9". */
export function formatarDiaCurto(ymd: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(diaUtc(ymd));
}

/** "14:00" (pt) / "2:00 PM" (en), in tz. */
export function formatarHora(iso: string, tz: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** Zone label shown next to times when the event is not in Brasília time; null otherwise. */
export function rotuloFuso(tz: string): string | null {
  return tz && tz !== FUSO_PADRAO ? tz.replace(/_/g, ' ') : null;
}

/**
 * The pieces a card needs to describe when an occurrence happens. The caller
 * joins them with translated connectors (no Intl.formatRange: it emits a dash).
 */
export interface Quando {
  /** Short start day, e.g. "qui., 9 de out.". */
  dia: string;
  /** Short last day when the occurrence spans several days, else null. */
  diaFim: string | null;
  /** Start / end time (null for all-day). */
  horaInicio: string | null;
  horaFim: string | null;
  diaInteiro: boolean;
  fuso: string | null;
}

export function quando(item: HubAgendaItem, locale: string): Quando {
  const inicioDia = diaLocal(item);
  const fimDia = ultimoDiaLocal(item);
  return {
    dia: formatarDiaCurto(inicioDia, locale),
    diaFim: fimDia !== inicioDia ? formatarDiaCurto(fimDia, locale) : null,
    horaInicio: item.dia_inteiro ? null : formatarHora(item.inicio, item.tz, locale),
    horaFim: item.dia_inteiro ? null : formatarHora(item.fim, item.tz, locale),
    diaInteiro: item.dia_inteiro,
    fuso: item.dia_inteiro ? null : rotuloFuso(item.tz),
  };
}

/** A reschedule suggestion in the occurrence's tz: "qui., 9 de out., 14:00" or just the day. */
export function formatarSugestao(
  inicioSugerido: string,
  item: Pick<HubAgendaItem, 'tz' | 'dia_inteiro'>,
  locale: string,
): string {
  const parede = paredeNoFuso(inicioSugerido, item.tz);
  const dia = formatarDiaCurto(parede.data, locale);
  if (item.dia_inteiro) return dia;
  const fuso = rotuloFuso(item.tz);
  const texto = `${dia}, ${formatarHora(inicioSugerido, item.tz, locale)}`;
  return fuso ? `${texto} (${fuso})` : texto;
}

export interface GrupoDia {
  dia: string;
  itens: HubAgendaItem[];
}

/** Groups items (already in display order) by their local start day, keeping that order. */
export function agruparPorDia(itens: HubAgendaItem[]): GrupoDia[] {
  const grupos: GrupoDia[] = [];
  const porDia = new Map<string, GrupoDia>();
  for (const item of itens) {
    const dia = diaLocal(item);
    let g = porDia.get(dia);
    if (!g) {
      g = { dia, itens: [] };
      porDia.set(dia, g);
      grupos.push(g);
    }
    g.itens.push(item);
  }
  return grupos;
}

/** Ascending by start instant, then id (the API's keyset order). */
export function compararInicio(a: HubAgendaItem, b: HubAgendaItem): number {
  const d = Date.parse(a.inicio) - Date.parse(b.inicio);
  return d !== 0 ? d : a.ocorrencia_id - b.ocorrencia_id;
}

/**
 * Validates a reschedule suggestion typed as wall time in the occurrence's tz.
 * Pure wall-clock comparisons in tz (no offset math): the server still
 * converts and re-checks, this only spares an obvious round trip.
 */
export function sugestaoNoPassado(
  data: string,
  hora: string | null,
  tz: string,
  agora: Date = new Date(),
): boolean {
  const hoje = paredeNoFuso(agora, tz);
  if (data < hoje.data) return true;
  if (data > hoje.data) return false;
  // Same day: an all-day suggestion for today has already started.
  if (hora === null) return true;
  return hora <= hoje.hora;
}

/** ISO instant -> 20261007T130000Z. */
const utc = (iso: string) =>
  new Date(iso)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

const diaCompacto = (d: string) => d.replace(/-/g, '');

/**
 * "Adicionar ao Google Agenda": a prefilled template link (same shape as the
 * CRM's linkGoogleAgenda). All-day uses the local dates with the exclusive end
 * Google expects; timed uses UTC instants.
 */
export function linkGoogleAgenda(item: HubAgendaItem, rotuloLink = 'Link da reunião'): string {
  const datas = item.dia_inteiro
    ? `${diaCompacto(item.data_inicio_local)}/${diaCompacto(item.data_fim_local)}`
    : `${utc(item.inicio)}/${utc(item.fim)}`;
  const detalhes = [
    item.descricao?.trim() || null,
    item.link_reuniao ? `${rotuloLink}: ${item.link_reuniao}` : null,
  ]
    .filter(Boolean)
    .join('\n\n');
  const p = new URLSearchParams({ action: 'TEMPLATE', text: item.titulo, dates: datas });
  if (detalhes) p.set('details', detalhes);
  if (item.local) p.set('location', item.local);
  if (item.tz) p.set('ctz', item.tz);
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}
