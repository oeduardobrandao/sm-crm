import { describe, expect, it } from 'vitest';
import {
  PHONE_WIDE_ROUTE_PATTERNS,
  TABLET_WIDE_ROUTE_PATTERNS,
  isPhoneWideRoute,
  isTabletWideRoute,
} from '../phoneWideRoutes';

describe('isPhoneWideRoute', () => {
  it.each([
    '/entregas',
    '/calendario',
    '/analytics',
    '/analytics/tiktok',
    '/analytics/youtube',
    '/analytics/google',
    '/analytics/42',
    '/analytics/42/posts',
    '/analytics-fluxos',
  ])('%s uses the full width', (path) => {
    expect(isPhoneWideRoute(path)).toBe(true);
  });

  it.each(['/clientes/7/entregas', '/dashboard', '/clientes', '/entregas-x', '/relatorios/9'])(
    '%s stays in the column',
    (path) => {
      expect(isPhoneWideRoute(path)).toBe(false);
    },
  );

  it('lists exactly the eight route roots', () => {
    expect(PHONE_WIDE_ROUTE_PATTERNS).toEqual([
      '/entregas',
      '/calendario',
      '/analytics',
      '/analytics/tiktok',
      '/analytics/youtube',
      '/analytics/google',
      '/analytics/:id/:tab?',
      '/analytics-fluxos',
    ]);
  });
});

describe('isTabletWideRoute', () => {
  it.each(['/relatorios/9', '/relatorios/modelos/3', '/relatorios/modelos/padrao'])(
    '%s uses the full width on a tablet',
    (path) => {
      expect(isTabletWideRoute(path)).toBe(true);
    },
  );

  it.each(['/relatorios', '/dashboard', '/entregas'])(
    '%s is not a tablet-only wide route',
    (path) => {
      expect(isTabletWideRoute(path)).toBe(false);
    },
  );

  it('lists the report editor routes', () => {
    expect(TABLET_WIDE_ROUTE_PATTERNS).toEqual([
      '/relatorios/:id',
      '/relatorios/modelos/:id',
      '/relatorios/modelos/padrao',
    ]);
  });
});
