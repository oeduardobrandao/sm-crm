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
});
