import { describe, it, expect, vi } from 'vitest';
import { buildNavModel, SECTION_IDS } from '../clienteDetalheNav.model';
import type { BuildNavModelInput } from '../clienteDetalheNav.model';

const NOW = 1_000_000_000_000; // fixed "now" for expiry math

function makeInput(over: Partial<BuildNavModelInput> = {}): BuildNavModelInput {
  return {
    isAgent: false,
    activeDeliveriesCount: 0,
    deliveryHistoryCount: 0,
    igSummary: undefined,
    hubToken: null,
    workspaceSlug: 'acme',
    contaId: 'conta-1',
    now: NOW,
    handlers: {
      onConnectInstagram: vi.fn(),
      onAnalytics: vi.fn(),
      onOpenHub: vi.fn(),
      onEditar: vi.fn(),
    },
    ...over,
  };
}

const sectionKeys = (m: ReturnType<typeof buildNavModel>) => m.sections.map((s) => s.key);
const actionKeys = (m: ReturnType<typeof buildNavModel>) => m.actions.map((a) => a.key);

describe('buildNavModel — sections', () => {
  it('owner with no deliveries: always-on sections, no entregas/historico', () => {
    const m = buildNavModel(makeInput());
    expect(sectionKeys(m)).toEqual([
      'info',
      'instagram',
      'relatorio',
      'hub',
      'arquivos',
      'datas',
      'enderecos',
      'financeiro',
    ]);
  });

  it('includes entregas and historico when their counts are > 0, in order', () => {
    const m = buildNavModel(makeInput({ activeDeliveriesCount: 2, deliveryHistoryCount: 1 }));
    expect(sectionKeys(m)).toEqual([
      'info',
      'entregas',
      'historico',
      'instagram',
      'relatorio',
      'hub',
      'arquivos',
      'datas',
      'enderecos',
      'financeiro',
    ]);
  });

  it('agent: no relatorio and no financeiro, but hub still present', () => {
    const m = buildNavModel(makeInput({ isAgent: true }));
    expect(sectionKeys(m)).not.toContain('relatorio');
    expect(sectionKeys(m)).not.toContain('financeiro');
    expect(sectionKeys(m)).toContain('hub');
  });

  it('agent: hub present even without contaId and workspaceSlug', () => {
    const m = buildNavModel(makeInput({ isAgent: true, contaId: null, workspaceSlug: undefined }));
    expect(sectionKeys(m)).toContain('hub');
    expect(sectionKeys(m)).not.toContain('relatorio');
    expect(sectionKeys(m)).not.toContain('financeiro');
  });

  it('owner: hub section absent until workspaceSlug and contaId are both present', () => {
    expect(sectionKeys(buildNavModel(makeInput({ workspaceSlug: undefined })))).not.toContain(
      'hub',
    );
    expect(sectionKeys(buildNavModel(makeInput({ contaId: null })))).not.toContain('hub');
    expect(sectionKeys(buildNavModel(makeInput()))).toContain('hub');
  });

  it('maps instagram to the existing ig-container id', () => {
    const m = buildNavModel(makeInput());
    expect(m.sections.find((s) => s.key === 'instagram')?.id).toBe('ig-container');
    expect(SECTION_IDS.info).toBe('sec-info');
  });
});

describe('buildNavModel — actions', () => {
  it('disconnected IG: connectInstagram + editar, no analytics/openHub', () => {
    const m = buildNavModel(makeInput({ igSummary: undefined, hubToken: null }));
    expect(actionKeys(m)).toEqual(['connectInstagram', 'editar']);
  });

  it('connected but still syncing (no last_synced_at): neither connect nor analytics', () => {
    const m = buildNavModel(makeInput({ igSummary: { account: { last_synced_at: null } } }));
    expect(actionKeys(m)).toEqual(['editar']);
  });

  it('connected and synced: analytics shown, connect hidden', () => {
    const m = buildNavModel(
      makeInput({ igSummary: { account: { last_synced_at: '2026-07-01' } } }),
    );
    expect(actionKeys(m)).toEqual(['analytics', 'editar']);
  });

  it('openHub only when token active, non-expired, and slug present', () => {
    const active = {
      is_active: true,
      token: 'tk',
      expires_at: new Date(NOW + 60_000).toISOString(),
    };
    expect(actionKeys(buildNavModel(makeInput({ hubToken: active })))).toContain('openHub');

    const expired = {
      is_active: true,
      token: 'tk',
      expires_at: new Date(NOW - 60_000).toISOString(),
    };
    expect(actionKeys(buildNavModel(makeInput({ hubToken: expired })))).not.toContain('openHub');

    const inactive = {
      is_active: false,
      token: 'tk',
      expires_at: new Date(NOW + 60_000).toISOString(),
    };
    expect(actionKeys(buildNavModel(makeInput({ hubToken: inactive })))).not.toContain('openHub');

    expect(
      actionKeys(buildNavModel(makeInput({ hubToken: active, workspaceSlug: undefined }))),
    ).not.toContain('openHub');
  });

  it('editar is always present and last', () => {
    const m = buildNavModel(
      makeInput({
        igSummary: { account: { last_synced_at: '2026-07-01' } },
        hubToken: {
          is_active: true,
          token: 'tk',
          expires_at: new Date(NOW + 60_000).toISOString(),
        },
      }),
    );
    expect(actionKeys(m)).toEqual(['analytics', 'openHub', 'editar']);
  });

  it('wires each action to its handler', () => {
    const input = makeInput({
      igSummary: undefined,
      hubToken: { is_active: true, token: 'tk', expires_at: new Date(NOW + 60_000).toISOString() },
    });
    const m = buildNavModel(input);
    m.actions.find((a) => a.key === 'connectInstagram')!.onClick();
    m.actions.find((a) => a.key === 'openHub')!.onClick();
    m.actions.find((a) => a.key === 'editar')!.onClick();
    expect(input.handlers.onConnectInstagram).toHaveBeenCalledTimes(1);
    expect(input.handlers.onOpenHub).toHaveBeenCalledTimes(1);
    expect(input.handlers.onEditar).toHaveBeenCalledTimes(1);
  });
});
