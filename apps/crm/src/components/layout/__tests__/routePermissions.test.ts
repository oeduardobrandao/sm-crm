import { describe, expect, it } from 'vitest';
import { resolveRouteGate } from '../routePermissions';

describe('resolveRouteGate', () => {
  it.each([
    '/dashboard',
    '/ajuda',
    '/ajuda/secao/foo',
    '/ajuda/secao',
    '/ajuda/algum-artigo',
    '/configuracao',
    '/configuracao/membros',
    '/comecar',
    '/workspace-setup',
    '/oauth/consent',
  ])('%s resolves to open', (pathname) => {
    expect(resolveRouteGate(pathname)).toBe('open');
  });

  it('/clientes resolves to {clientes, ver}', () => {
    expect(resolveRouteGate('/clientes')).toEqual({ module: 'clientes', action: 'ver' });
  });

  it('/clientes/42/financeiro resolves to the PARENT module gate {clientes, ver} — the financeiro sub-tab has its own gate in clienteTabs.model.ts', () => {
    expect(resolveRouteGate('/clientes/42/financeiro')).toEqual({
      module: 'clientes',
      action: 'ver',
    });
  });

  it.each(['/entregas', '/post-express'])('%s resolves to {entregas, ver}', (pathname) => {
    expect(resolveRouteGate(pathname)).toEqual({ module: 'entregas', action: 'ver' });
  });

  it('/calendario resolves to {calendario, ver}', () => {
    expect(resolveRouteGate('/calendario')).toEqual({ module: 'calendario', action: 'ver' });
  });

  it('/aprovacoes resolves to {aprovacoes, ver}', () => {
    expect(resolveRouteGate('/aprovacoes')).toEqual({ module: 'aprovacoes', action: 'ver' });
  });

  it('/arquivos resolves to {arquivos, ver}', () => {
    expect(resolveRouteGate('/arquivos')).toEqual({ module: 'arquivos', action: 'ver' });
  });

  it('/ideias resolves to {ideias, ver}', () => {
    expect(resolveRouteGate('/ideias')).toEqual({ module: 'ideias', action: 'ver' });
  });

  it('/tarefas resolves to {tarefas, ver}', () => {
    expect(resolveRouteGate('/tarefas')).toEqual({ module: 'tarefas', action: 'ver' });
  });

  it('/leads resolves to {leads, ver}', () => {
    expect(resolveRouteGate('/leads')).toEqual({ module: 'leads', action: 'ver' });
  });

  it('/financeiro resolves to {financeiro, ver}', () => {
    expect(resolveRouteGate('/financeiro')).toEqual({ module: 'financeiro', action: 'ver' });
  });

  it('/contratos resolves to {contratos, ver}', () => {
    expect(resolveRouteGate('/contratos')).toEqual({ module: 'contratos', action: 'ver' });
  });

  it.each(['/equipe', '/equipe/7'])('%s resolves to {equipe, ver}', (pathname) => {
    expect(resolveRouteGate(pathname)).toEqual({ module: 'equipe', action: 'ver' });
  });

  it.each(['/analytics', '/analytics/9', '/analytics-fluxos', '/relatorios/abc'])(
    '%s resolves to {analytics, ver}',
    (pathname) => {
      expect(resolveRouteGate(pathname)).toEqual({ module: 'analytics', action: 'ver' });
    },
  );

  it.each(['/mensagens', '/mensagens/3'])('%s resolves to {clientes, ver}', (pathname) => {
    expect(resolveRouteGate(pathname)).toEqual({ module: 'clientes', action: 'ver' });
  });

  it('/automacoes resolves to {automacoes, ver}', () => {
    expect(resolveRouteGate('/automacoes')).toEqual({ module: 'automacoes', action: 'ver' });
  });

  it('/importar resolves to {clientes, editar}', () => {
    expect(resolveRouteGate('/importar')).toEqual({ module: 'clientes', action: 'editar' });
  });

  it('an unregistered route resolves to unmapped', () => {
    expect(resolveRouteGate('/rota-inventada')).toBe('unmapped');
  });

  it('/Financeiro (capitalized) resolves exactly like /financeiro — case-insensitive internally, not just via the caller', () => {
    expect(resolveRouteGate('/Financeiro')).toEqual(resolveRouteGate('/financeiro'));
    expect(resolveRouteGate('/Financeiro')).toEqual({ module: 'financeiro', action: 'ver' });
  });

  describe('segment-boundary matching', () => {
    it('/clientesx does not match /clientes — resolves unmapped', () => {
      expect(resolveRouteGate('/clientesx')).toBe('unmapped');
    });

    it('/equipex does not match /equipe — resolves unmapped', () => {
      expect(resolveRouteGate('/equipex')).toBe('unmapped');
    });

    it('/analytics-fluxos never falls back to the /analytics gate by prefix accident (same gate here, but a distinct rule)', () => {
      // Both resolve to {analytics, ver}, so this alone wouldn't catch a
      // cross-match — the boundary-matching unit is proven directly by the
      // /clientesx and /equipex cases above; this just documents that the two
      // routes are handled by their OWN rules, not a substring fallthrough.
      expect(resolveRouteGate('/analytics-fluxos')).toEqual({
        module: 'analytics',
        action: 'ver',
      });
    });
  });

  describe('full App.tsx authenticated-route coverage', () => {
    // Hardcoded from App.tsx:154-241 (the /workspace-setup, /comecar,
    // /oauth/consent routes plus every route inside the two ProtectedRoute-
    // wrapped blocks). Dynamic segments (:id, :slug, etc.) are represented by
    // one concrete example each. KEEP IN SYNC WITH App.tsx: any new
    // authenticated route added there needs an entry in routePermissions.ts's
    // ROUTES table AND a line here, or it silently resolves 'unmapped' and
    // gets deny-by-default in production (ProtectedRoute redirects to
    // /dashboard and logs a console.error in DEV).
    const APP_TSX_PROTECTED_ROUTES = [
      '/workspace-setup',
      '/comecar',
      '/oauth/consent',
      '/dashboard',
      '/clientes',
      '/clientes/42',
      '/financeiro',
      '/contratos',
      '/leads',
      '/equipe',
      '/equipe/42',
      '/configuracao',
      '/calendario',
      '/entregas',
      '/tarefas',
      '/post-express',
      '/arquivos',
      '/analytics',
      '/analytics/42',
      '/relatorios/42',
      '/analytics-fluxos',
      '/ideias',
      '/mensagens',
      '/mensagens/42',
      '/automacoes',
      '/importar',
      '/ajuda',
      '/ajuda/secao/geral',
      '/ajuda/secao',
      '/ajuda/algum-artigo',
    ];

    it.each(APP_TSX_PROTECTED_ROUTES)('%s resolves to something other than unmapped', (path) => {
      expect(resolveRouteGate(path)).not.toBe('unmapped');
    });
  });
});
