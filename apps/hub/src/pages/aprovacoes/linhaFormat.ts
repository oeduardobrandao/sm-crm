import type { HubLinhaColuna } from '../../types';

/** Month name of a `periodo` (YYYY-MM-DD), or of a 0-based month index. */
export function monthName(periodoOrIndex: string | number, lang: string): string {
  const date =
    typeof periodoOrIndex === 'number'
      ? new Date(Date.UTC(2000, periodoOrIndex, 1))
      : new Date(`${periodoOrIndex.slice(0, 7)}-01T00:00:00Z`);
  return new Intl.DateTimeFormat(lang, { month: 'long', timeZone: 'UTC' }).format(date);
}

/** "ter." and 3, for a date-only value. Date-only means UTC math: no timezone shifts the day. */
export function dayParts(data: string, lang: string): { weekday: string; day: number } {
  const date = new Date(`${data.slice(0, 10)}T00:00:00Z`);
  return {
    weekday: new Intl.DateTimeFormat(lang, { weekday: 'short', timeZone: 'UTC' }).format(date),
    day: date.getUTCDate(),
  };
}

/** "10 de novembro" for an instant (enviada_at, decidida_at), in the agency's timezone. */
export function instantLabel(iso: string | null, lang: string): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat(lang, {
    day: 'numeric',
    month: 'long',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(iso));
}

/**
 * The text of one extra column's value, or '' when there is nothing to show. A key the
 * column no longer knows never reaches here: the caller walks the columns, not the values.
 * `person` values are workspace user ids, which mean nothing to a client.
 */
export function formatColumnValue(
  coluna: HubLinhaColuna,
  value: unknown,
  lang: string,
  yes: string,
): string {
  if (value === null || value === undefined || value === '') return '';
  const optionLabel = (id: unknown) => coluna.config.options?.find((o) => o.id === id)?.label ?? '';
  switch (coluna.tipo) {
    case 'select':
      return optionLabel(value);
    case 'multiselect':
      return Array.isArray(value) ? value.map(optionLabel).filter(Boolean).join(', ') : '';
    case 'date':
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)
        ? new Intl.DateTimeFormat(lang, {
            day: 'numeric',
            month: 'short',
            timeZone: 'UTC',
          }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`))
        : '';
    case 'checkbox':
      return value === true ? yes : '';
    case 'text':
    case 'number':
    case 'url':
      return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
    default:
      return '';
  }
}
