import { mesLabel } from './linhaLogic';

/** `YYYY-MM` shifted by `delta` months. */
export function shiftMes(mes: string, delta: number): string {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** "Novembro 2026". */
export function mesTitulo(mes: string): string {
  const nome = mesLabel(mes);
  return `${nome.charAt(0).toUpperCase()}${nome.slice(1)} ${mes.slice(0, 4)}`;
}
