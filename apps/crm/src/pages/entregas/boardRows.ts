import type { WorkflowTemplate } from '../../store';
import type { BoardCard } from './hooks/useEntregasData';

/** Uma coluna do quadro de Fluxos: identidade pela ORDEM da etapa dentro da
 *  linha, nunca pelo nome. Duas etapas chamadas "Aprovação" são duas colunas. */
export interface BoardColumn {
  ordem: number;
  nome: string;
  tipo: 'padrao' | 'aprovacao_cliente';
  cards: BoardCard[];
}

export interface BoardRow {
  key: string;
  label: string;
  /** Ordenadas por `ordem` ascendente. */
  columns: BoardColumn[];
}

const KEY_SEP = '::';

export function columnKey(rowKey: string, ordem: number): string {
  return `${rowKey}${KEY_SEP}${ordem}`;
}

/** Inverso de columnKey. O rowKey pode conter "::"? Não: chaves de template são
 *  `template:<id>` e chaves sem template são nomes unidos por " → ". Mesmo assim
 *  a ordem é sempre o ÚLTIMO segmento, então o split é pelo último separador. */
export function parseColumnKey(key: string): { rowKey: string; ordem: number } | null {
  const idx = key.lastIndexOf(KEY_SEP);
  if (idx === -1) return null;
  const ordem = Number(key.slice(idx + KEY_SEP.length));
  if (!Number.isInteger(ordem)) return null;
  return { rowKey: key.slice(0, idx), ordem };
}

export function buildBoardRows(cards: BoardCard[], templates: WorkflowTemplate[]): BoardRow[] {
  const rowMap = new Map<
    string,
    { key: string; label: string; columns: Map<number, BoardColumn> }
  >();
  for (const card of cards) {
    const sorted = [...card.allEtapas].sort((a, b) => a.ordem - b.ordem);
    const key =
      card.workflow.template_id != null
        ? `template:${card.workflow.template_id}`
        : sorted.map((e) => e.nome).join(' → ');
    if (!rowMap.has(key)) {
      const t = templates.find((t) => t.id === card.workflow.template_id);
      rowMap.set(key, { key, label: (t ? t.nome : key).toUpperCase(), columns: new Map() });
    }
    const row = rowMap.get(key)!;
    // Garante a coluna de cada etapa deste card (templates evoluem; um card pode
    // ter uma etapa a mais). O nome e o tipo vêm do primeiro card que trouxe a ordem.
    for (const e of sorted) {
      if (!row.columns.has(e.ordem)) {
        row.columns.set(e.ordem, {
          ordem: e.ordem,
          nome: e.nome,
          tipo: e.tipo ?? 'padrao',
          cards: [],
        });
      }
    }
    row.columns.get(card.etapa.ordem)?.cards.push(card);
  }
  const rows: BoardRow[] = [];
  for (const r of rowMap.values()) {
    const columns = [...r.columns.values()].sort((a, b) => a.ordem - b.ordem);
    for (const col of columns) {
      col.cards.sort((a, b) => (a.workflow.position ?? 0) - (b.workflow.position ?? 0));
    }
    if (columns.some((c) => c.cards.length > 0)) rows.push({ key: r.key, label: r.label, columns });
  }
  return rows;
}

export function findCardColumn(
  cardId: string,
  rows: BoardRow[],
): { row: BoardRow; column: BoardColumn } | null {
  for (const row of rows) {
    for (const column of row.columns) {
      if (column.cards.some((c) => String(c.workflow.id) === cardId)) return { row, column };
    }
  }
  return null;
}
