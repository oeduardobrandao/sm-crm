import { describe, expect, it } from 'vitest';
import {
  buildBoardRows,
  columnKey,
  findCardColumn,
  isValidDropTarget,
  parseColumnKey,
} from '../boardRows';
import type { BoardCard } from '../hooks/useEntregasData';

type EtapaLike = { id: number; ordem: number; nome: string; tipo?: 'padrao' | 'aprovacao_cliente' };

function makeCard(
  wfId: number,
  templateId: number | null,
  etapas: EtapaLike[],
  ativaOrdem: number,
  position = 0,
): BoardCard {
  const all = etapas.map((e) => ({
    id: e.id,
    workflow_id: wfId,
    ordem: e.ordem,
    nome: e.nome,
    tipo: e.tipo ?? 'padrao',
    prazo_dias: 1,
    tipo_prazo: 'corridos' as const,
    status: e.ordem === ativaOrdem ? ('ativo' as const) : ('pendente' as const),
  }));
  const etapa = all.find((e) => e.ordem === ativaOrdem)!;
  return {
    workflow: {
      id: wfId,
      cliente_id: 1,
      titulo: `WF ${wfId}`,
      status: 'ativo',
      etapa_atual: ativaOrdem,
      recorrente: false,
      template_id: templateId,
      position,
    },
    etapa,
    cliente: undefined,
    membro: undefined,
    deadline: { diasRestantes: 1, horasRestantes: 0, estourado: false, urgente: false },
    totalEtapas: all.length,
    etapaIdx: ativaOrdem,
    allEtapas: all,
  } as unknown as BoardCard;
}

const DUP = [
  { id: 1, ordem: 0, nome: 'Copy' },
  { id: 2, ordem: 1, nome: 'Aprovação', tipo: 'aprovacao_cliente' as const },
  { id: 3, ordem: 2, nome: 'Design' },
  { id: 4, ordem: 3, nome: 'Aprovação', tipo: 'aprovacao_cliente' as const },
];

describe('buildBoardRows', () => {
  it('mantém duas etapas de mesmo nome como colunas distintas, por ordem', () => {
    const rows = buildBoardRows([makeCard(1, 7, DUP, 1), makeCard(2, 7, DUP, 3)], []);
    expect(rows).toHaveLength(1);
    expect(rows[0].columns.map((c) => c.ordem)).toEqual([0, 1, 2, 3]);
    expect(rows[0].columns.map((c) => c.nome)).toEqual([
      'Copy',
      'Aprovação',
      'Design',
      'Aprovação',
    ]);
    expect(rows[0].columns[1].cards.map((c) => c.workflow.id)).toEqual([1]);
    expect(rows[0].columns[3].cards.map((c) => c.workflow.id)).toEqual([2]);
  });

  it('marca o tipo da coluna a partir da etapa', () => {
    const rows = buildBoardRows([makeCard(1, 7, DUP, 0)], []);
    expect(rows[0].columns.map((c) => c.tipo)).toEqual([
      'padrao',
      'aprovacao_cliente',
      'padrao',
      'aprovacao_cliente',
    ]);
  });

  it('usa o rótulo do template quando existe e ordena cards por position', () => {
    const rows = buildBoardRows(
      [makeCard(1, 7, DUP, 0, 5), makeCard(2, 7, DUP, 0, 2)],
      [{ id: 7, nome: 'Redes', etapas: [] } as never],
    );
    expect(rows[0].key).toBe('template:7');
    expect(rows[0].label).toBe('REDES');
    expect(rows[0].columns[0].cards.map((c) => c.workflow.id)).toEqual([2, 1]);
  });

  it('sem template, agrupa pelos nomes unidos', () => {
    const rows = buildBoardRows([makeCard(1, null, DUP, 0)], []);
    expect(rows[0].key).toBe('Copy → Aprovação → Design → Aprovação');
  });

  it('acrescenta colunas que só alguns cards têm, na posição da ordem', () => {
    const longer = [...DUP, { id: 5, ordem: 4, nome: 'Publicação' }];
    const rows = buildBoardRows([makeCard(1, 7, DUP, 0), makeCard(2, 7, longer, 4)], []);
    expect(rows[0].columns.map((c) => c.ordem)).toEqual([0, 1, 2, 3, 4]);
    expect(rows[0].columns[4].cards.map((c) => c.workflow.id)).toEqual([2]);
  });

  it('descarta linhas sem nenhum card', () => {
    expect(buildBoardRows([], [])).toEqual([]);
  });
});

describe('columnKey / parseColumnKey', () => {
  it('serializa e volta', () => {
    expect(columnKey('template:7', 3)).toBe('template:7::3');
    expect(parseColumnKey('template:7::3')).toEqual({ rowKey: 'template:7', ordem: 3 });
    expect(parseColumnKey('Copy → Design::1')).toEqual({ rowKey: 'Copy → Design', ordem: 1 });
    expect(parseColumnKey('sem-separador')).toBeNull();
    expect(parseColumnKey('template:7::x')).toBeNull();
    expect(parseColumnKey('template:7::')).toBeNull();
  });
});

describe('findCardColumn', () => {
  it('localiza a coluna de um card pelo id do workflow', () => {
    const rows = buildBoardRows([makeCard(1, 7, DUP, 3)], []);
    const hit = findCardColumn('1', rows);
    expect(hit?.column.ordem).toBe(3);
    expect(findCardColumn('99', rows)).toBeNull();
  });
});

describe('isValidDropTarget', () => {
  const etapas = [{ ordem: 0 }, { ordem: 1 }, { ordem: 2 }];
  it('aceita a adjacente que existe no fluxo', () => {
    expect(isValidDropTarget(etapas, 1, 2)).toBe(true);
    expect(isValidDropTarget(etapas, 1, 0)).toBe(true);
  });
  it('rejeita salto de mais de uma etapa', () => {
    expect(isValidDropTarget(etapas, 0, 2)).toBe(false);
  });
  it('rejeita coluna adjacente que o fluxo arrastado não tem', () => {
    // fluxo com 0..2 na ordem 2; a coluna 3 veio de outro fluxo da mesma linha
    expect(isValidDropTarget(etapas, 2, 3)).toBe(false);
  });
});
