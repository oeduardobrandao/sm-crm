import { describe, expect, it } from 'vitest';
import type { PostStatusDefinition } from '../../../store';
import {
  buildStatusRegistry,
  customKey,
  groupOptionsByOwner,
  isStatusKeyToken,
  postMatchesStatusFilter,
  statusKeyToPatch,
} from '../statusRegistry';
import { POST_STATUS_ORDER, STATUS_LABELS } from '../postLabels';

const UUID_A = '11111111-2222-3333-4444-555555555555';
const UUID_B = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const UUID_C = '99999999-8888-7777-6666-555555555555';

function def(overrides: Partial<PostStatusDefinition>): PostStatusDefinition {
  return {
    id: UUID_A,
    conta_id: 'conta-1',
    nome: 'Em design',
    cor: '#7c5cff',
    icone: null,
    behaves_as: 'revisao_interna',
    ordem: 0,
    arquivado: false,
    created_at: '2026-08-05T00:00:00Z',
    updated_at: '2026-08-05T00:00:00Z',
    ...overrides,
  };
}

describe('buildStatusRegistry', () => {
  it('passes the custom definition icone through to its option', () => {
    const registry = buildStatusRegistry([def({ id: UUID_A, icone: 'palette' })]);
    const custom = registry.options.find((o) => o.kind === 'custom');
    expect(custom?.icone).toBe('palette');
    expect(registry.options.find((o) => o.key === 'rascunho')?.icone).toBeUndefined();
  });

  it('with no definitions yields exactly the canonical pipeline', () => {
    const registry = buildStatusRegistry([]);
    expect(registry.options.map((o) => o.key)).toEqual([...POST_STATUS_ORDER]);
    expect(registry.hasCustom).toBe(false);
  });

  it('inserts customs right after their behaves_as anchor, ordered by ordem', () => {
    const registry = buildStatusRegistry([
      def({ id: UUID_B, nome: 'Copy check', ordem: 2 }),
      def({ id: UUID_A, nome: 'Em design', ordem: 1 }),
      def({ id: UUID_C, nome: 'Briefing', behaves_as: 'rascunho', ordem: 0 }),
    ]);
    const keys = registry.options.map((o) => o.key);
    expect(keys).toEqual([
      'rascunho',
      customKey(UUID_C),
      'revisao_interna',
      customKey(UUID_A),
      customKey(UUID_B),
      'aprovado_interno',
      'enviado_cliente',
      'aprovado_cliente',
      'correcao_cliente',
      'agendado',
      'postado',
      'falha_publicacao',
    ]);
    const custom = registry.byKey.get(customKey(UUID_A))!;
    expect(custom).toMatchObject({
      kind: 'custom',
      canonical: 'revisao_interna',
      label: 'Em design',
      color: '#7c5cff',
    });
    expect(registry.hasCustom).toBe(true);
  });

  it('skips archived definitions', () => {
    const registry = buildStatusRegistry([def({ arquivado: true })]);
    expect(registry.hasCustom).toBe(false);
  });

  it('resolve prefers the custom pointer and falls back to canonical', () => {
    const registry = buildStatusRegistry([def({})]);
    expect(registry.resolve({ status: 'revisao_interna', custom_status_id: UUID_A }).label).toBe(
      'Em design',
    );
    // Unknown pointer (deleted/archived def): canonical fallback.
    expect(registry.resolve({ status: 'revisao_interna', custom_status_id: UUID_B }).label).toBe(
      STATUS_LABELS.revisao_interna,
    );
    expect(registry.resolve({ status: 'postado' }).key).toBe('postado');
  });
});

describe('statusKeyToPatch', () => {
  it('custom key sends only the pointer (DB forces the canonical)', () => {
    expect(statusKeyToPatch(customKey(UUID_A))).toEqual({ custom_status_id: UUID_A });
  });

  it('canonical key always sends an explicit null pointer', () => {
    expect(statusKeyToPatch('aprovado_interno')).toEqual({
      status: 'aprovado_interno',
      custom_status_id: null,
    });
  });
});

describe('postMatchesStatusFilter', () => {
  const inCustom = { status: 'revisao_interna' as const, custom_status_id: UUID_A };
  const plain = { status: 'revisao_interna' as const, custom_status_id: null };

  it('canonical key matches the canonical column, including posts in customs', () => {
    expect(postMatchesStatusFilter(inCustom, ['revisao_interna'])).toBe(true);
    expect(postMatchesStatusFilter(plain, ['revisao_interna'])).toBe(true);
    expect(postMatchesStatusFilter(plain, ['rascunho'])).toBe(false);
  });

  it('custom key matches only that pointer', () => {
    expect(postMatchesStatusFilter(inCustom, [customKey(UUID_A)])).toBe(true);
    expect(postMatchesStatusFilter(plain, [customKey(UUID_A)])).toBe(false);
    expect(postMatchesStatusFilter(inCustom, [customKey(UUID_B)])).toBe(false);
  });
});

describe('isStatusKeyToken', () => {
  it('accepts canonical statuses and custom:<uuid> tokens', () => {
    expect(isStatusKeyToken('rascunho')).toBe(true);
    expect(isStatusKeyToken(customKey(UUID_A))).toBe(true);
  });

  it('rejects malformed tokens', () => {
    expect(isStatusKeyToken('custom:')).toBe(false);
    expect(isStatusKeyToken('custom:not-a-uuid')).toBe(false);
    expect(isStatusKeyToken('custom:11111111-2222-3333-4444-55555555555Z')).toBe(false);
    expect(isStatusKeyToken('publicando')).toBe(false);
    expect(isStatusKeyToken('')).toBe(false);
  });
});

describe('groupOptionsByOwner', () => {
  it('splits the canonical statuses into who actually writes them', () => {
    const groups = groupOptionsByOwner(buildStatusRegistry([]).options);

    expect(groups.map((g) => g.owner)).toEqual(['equipe', 'cliente', 'sistema']);
    expect(groups.map((g) => g.options.map((o) => o.key))).toEqual([
      ['rascunho', 'revisao_interna', 'aprovado_interno', 'enviado_cliente', 'agendado'],
      ['aprovado_cliente', 'correcao_cliente'],
      ['postado', 'falha_publicacao'],
    ]);
  });

  it('loses no option and keeps each group in pipeline order', () => {
    const options = buildStatusRegistry([]).options;
    const flattened = groupOptionsByOwner(options).flatMap((g) => g.options);

    expect(flattened).toHaveLength(options.length);
    for (const group of groupOptionsByOwner(options)) {
      const positions = group.options.map((o) => options.indexOf(o));
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    }
  });

  it('files a custom status under its anchor owner, not under equipe', () => {
    const registry = buildStatusRegistry([
      def({ id: UUID_A, nome: 'Em design', behaves_as: 'rascunho', ordem: 0 }),
      def({ id: UUID_B, nome: 'Publicado manualmente', behaves_as: 'postado', ordem: 0 }),
    ]);
    const groups = groupOptionsByOwner(registry.options);

    expect(groups.find((g) => g.owner === 'equipe')!.options.map((o) => o.key)).toContain(
      customKey(UUID_A),
    );
    expect(groups.find((g) => g.owner === 'sistema')!.options.map((o) => o.key)).toContain(
      customKey(UUID_B),
    );
  });

  it('drops groups that have no options', () => {
    const onlyEquipe = buildStatusRegistry([]).options.filter((o) => o.key === 'rascunho');

    expect(groupOptionsByOwner(onlyEquipe).map((g) => g.owner)).toEqual(['equipe']);
  });
});
