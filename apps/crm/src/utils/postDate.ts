export const MESES_ABREV = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];

// Compact pt-BR publish-date label, e.g. "8 jun · 14h" or "18 jul · 18h30".
// Minutes show only when non-zero; the year is appended only when it differs from
// the current year, so an off-year date never reads ambiguously.
export function formatPostDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const ano = d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : '';
  const hh = String(d.getHours()).padStart(2, '0');
  const min = d.getMinutes();
  const hora = min === 0 ? `${hh}h` : `${hh}h${String(min).padStart(2, '0')}`;
  return `${d.getDate()} ${MESES_ABREV[d.getMonth()]}${ano} · ${hora}`;
}

// Full, readable form for tooltips, e.g. "8 de junho de 2026, 14:00".
export function formatPostDateFull(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' a partir dos componentes LOCAIS. Nunca use
 *  `toISOString().split('T')[0]` para um dia de calendário: ele converte para
 *  UTC antes de cortar e muda o dia no Brasil (spec de processos §7). */
export function toLocalISODate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Meia-noite local de 'YYYY-MM-DD' (aceita um timestamp e usa os 10 primeiros
 *  caracteres). `new Date('YYYY-MM-DD')` seria meia-noite UTC. */
export function parseLocalISODate(s: string): Date | null {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/** 23:59:59.999 local do dia de `d`: o instante que "fim daquele dia" vira
 *  como timestamptz (spec de processos §7, prazo congelado de data_limite). */
export function endOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}
