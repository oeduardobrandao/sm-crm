import { matchPath } from 'react-router-dom';

/**
 * Routes that opt out of the centered 680px column on a wide phone shell (a touch tablet,
 * or a phone held sideways): their collections use the whole width. Nothing else does;
 * the client detail's Entregas tab (`/clientes/:id/entregas`) stays in the column.
 */
export const PHONE_WIDE_ROUTE_PATTERNS: readonly string[] = [
  '/entregas',
  '/calendario',
  '/analytics',
  '/analytics/tiktok',
  '/analytics/youtube',
  '/analytics/google',
  '/analytics/:id/:tab?',
  '/analytics-fluxos',
];

/**
 * Wide only on a tablet, where the desktop report editor renders inside the phone shell.
 * On a phone in landscape the phone report view stays in the column.
 */
export const TABLET_WIDE_ROUTE_PATTERNS: readonly string[] = [
  '/relatorios/:id',
  '/relatorios/modelos/:id',
  '/relatorios/modelos/padrao',
];

function matchesAny(patterns: readonly string[], pathname: string): boolean {
  return patterns.some((path) => matchPath({ path, end: true }, pathname) !== null);
}

export function isPhoneWideRoute(pathname: string): boolean {
  return matchesAny(PHONE_WIDE_ROUTE_PATTERNS, pathname);
}

export function isTabletWideRoute(pathname: string): boolean {
  return matchesAny(TABLET_WIDE_ROUTE_PATTERNS, pathname);
}
