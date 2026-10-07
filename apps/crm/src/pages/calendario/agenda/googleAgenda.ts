import type { AgendaOcorrencia } from '@/store/agenda';

/** ISO instant (any offset) -> 20261007T130000Z. */
const utc = (iso: string) =>
  new Date(iso)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

/** yyyy-mm-dd -> yyyymmdd. */
const dia = (d: string) => d.replace(/-/g, '');

/** "Adicionar ao Google Agenda": a prefilled template link, built client-side.
 *  All-day events use series-local dates, and `data_fim_local` is already the
 *  exclusive end Google expects. Params go through URLSearchParams so titles
 *  with `&`, `#` or accents survive. */
export function linkGoogleAgenda(o: AgendaOcorrencia): string {
  const datas = o.dia_inteiro
    ? `${dia(o.data_inicio_local)}/${dia(o.data_fim_local)}`
    : `${utc(o.inicio)}/${utc(o.fim)}`;
  const detalhes = [
    o.descricao?.trim() || null,
    o.link_reuniao ? `Link da reunião: ${o.link_reuniao}` : null,
  ]
    .filter(Boolean)
    .join('\n\n');
  const p = new URLSearchParams({ action: 'TEMPLATE', text: o.titulo, dates: datas });
  if (detalhes) p.set('details', detalhes);
  if (o.local) p.set('location', o.local);
  if (o.tz) p.set('ctz', o.tz);
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}
