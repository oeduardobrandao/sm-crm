import { describe, expect, it } from 'vitest';
import { buildFingerprint, buildTemplateFingerprint } from '../fingerprint';

// Fixtures copied verbatim from supabase/tests/entitlements/85_post_process_fingerprints.sql
// (85.0, 85.3, 85.4, 85.5, 85.6). The SQL side is the reference; these strings are the
// contract the RPCs of fase 4 will compare against.
describe('buildFingerprint', () => {
  it('85.0: formato exato do fluxo, com nulos, tipo default e timestamp UTC', () => {
    const fp = buildFingerprint({ etapa_atual: 1 }, [
      {
        id: 1,
        ordem: 0,
        nome: 'Copy',
        prazo_dias: 2,
        tipo_prazo: 'corridos',
        tipo: 'padrao',
        status: 'concluido',
        iniciado_em: '2026-09-01T12:00:00+00:00',
        data_limite: null,
      },
      {
        id: 2,
        ordem: 1,
        nome: 'Design',
        prazo_dias: 3,
        tipo_prazo: 'uteis',
        tipo: null,
        status: 'ativo',
        iniciado_em: '2026-09-03T09:30:00+00:00',
        data_limite: '2026-09-10',
      },
    ]);
    expect(fp).toBe(
      'etapa_atual=1\n' +
        '0|Copy|padrao|concluido||2|corridos||2026-09-01T12:00:00.000Z\n' +
        '1|Design|padrao|ativo||3|uteis|2026-09-10|2026-09-03T09:30:00.000Z',
    );
  });

  it('85.5: uma etapa sem iniciado_em nem data_limite serializa campos vazios no fim', () => {
    const fp = buildFingerprint({ etapa_atual: 1 }, [
      { id: 1, ordem: 0, nome: 'Copy', prazo_dias: 2, tipo_prazo: 'corridos', status: 'ativo' },
    ]);
    expect(fp).toBe('etapa_atual=1\n0|Copy|padrao|ativo||2|corridos||');
  });

  it('85.6: etapa_atual null serializa cabeçalho vazio, distinto de 0', () => {
    expect(buildFingerprint({ etapa_atual: null }, [])).toBe('etapa_atual=');
    expect(buildFingerprint({ etapa_atual: 0 }, [])).toBe('etapa_atual=0');
    expect(buildFingerprint({ etapa_atual: undefined }, [])).toBe('etapa_atual=');
  });

  it('ordena por (ordem, id), o mesmo desempate do ORDER BY e.ordem, e.id', () => {
    const fp = buildFingerprint({ etapa_atual: 0 }, [
      { id: 9, ordem: 0, nome: 'B', prazo_dias: 1, tipo_prazo: 'corridos', status: 'pendente' },
      { id: 3, ordem: 0, nome: 'A', prazo_dias: 1, tipo_prazo: 'corridos', status: 'pendente' },
      { id: 1, ordem: 1, nome: 'C', prazo_dias: 1, tipo_prazo: 'corridos', status: 'pendente' },
    ]);
    expect(fp.split('\n').slice(1)).toEqual([
      '0|A|padrao|pendente||1|corridos||',
      '0|B|padrao|pendente||1|corridos||',
      '1|C|padrao|pendente||1|corridos||',
    ]);
  });

  it('tipo vazio vira padrao e responsavel_id aparece cru', () => {
    const fp = buildFingerprint({ etapa_atual: 0 }, [
      {
        id: 1,
        ordem: 0,
        nome: 'Copy',
        tipo: '',
        responsavel_id: 42,
        prazo_dias: 2,
        tipo_prazo: 'uteis',
        status: 'ativo',
      },
    ]);
    expect(fp).toBe('etapa_atual=0\n0|Copy|padrao|ativo|42|2|uteis||');
  });
});

describe('buildTemplateFingerprint', () => {
  it('85.3: formato exato do template, com ordem base zero e sem cabeçalho', () => {
    const fp = buildTemplateFingerprint([
      { nome: 'Copy', prazo_dias: 2, tipo_prazo: 'corridos' },
      { nome: 'Aprovacao', prazo_dias: 1, tipo_prazo: 'uteis', tipo: 'aprovacao_cliente' },
    ]);
    expect(fp).toBe('0|Copy|padrao|2|corridos\n1|Aprovacao|aprovacao_cliente|1|uteis');
  });

  it('85.4: etapas vazio devolve string vazia; não-array também', () => {
    expect(buildTemplateFingerprint([])).toBe('');
    expect(buildTemplateFingerprint(null)).toBe('');
    expect(buildTemplateFingerprint({ nome: 'x' })).toBe('');
  });

  it('não normaliza números: o valor cru passa por String()', () => {
    // 2.5 nunca acontece num template salvo pelo CRM (inputs inteiros), mas o
    // espelho não pode "corrigir" nada: SQL serializa e.val ->> 'prazo_dias' cru.
    expect(buildTemplateFingerprint([{ nome: 'A', prazo_dias: 2.5, tipo_prazo: 'uteis' }])).toBe(
      '0|A|padrao|2.5|uteis',
    );
  });
});
