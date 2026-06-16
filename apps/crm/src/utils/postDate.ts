const MESES_ABREV = [
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
