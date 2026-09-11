import type { WorkflowTemplate } from '../../store';
import type { BoardCard } from './hooks/useEntregasData';
import { entityNumericId, stageSignature, type BoardEntity, type PostEntity } from './boardEntity';

/** Uma coluna do quadro de Fluxos: identidade pela ORDEM da etapa dentro da
 *  linha, nunca pelo nome. Duas etapas chamadas "Aprovação" são duas colunas.
 *  `cards` são fluxos (arrastáveis); `posts` são processos individuais
 *  (fase 3: só leitura, sem drag). */
export interface BoardColumn {
  ordem: number;
  nome: string;
  tipo: 'padrao' | 'aprovacao_cliente';
  cards: BoardCard[];
  posts: PostEntity[];
}

export interface BoardRow {
  key: string;
  label: string;
  /** Template da linha, para o botão "Novo fluxo" da primeira coluna. */
  templateId: number | null;
  /** Ordenadas por `ordem` ascendente. */
  columns: BoardColumn[];
}

export interface BuildBoardRowsOptions {
  /** Spec §4.1: chave `template:<id>#<assinatura>` / `custom#<assinatura>`, de
   *  modo que snapshots divergentes do mesmo template viram linhas próprias.
   *  Ligado pela feature_post_processes; desligado, a chave é a de sempre
   *  (`template:<id>` ou nomes unidos), byte a byte. */
  signatureRows?: boolean;
}

const KEY_SEP = '::';

export function columnKey(rowKey: string, ordem: number): string {
  return `${rowKey}${KEY_SEP}${ordem}`;
}

/** Inverso de columnKey. A ordem é sempre o ÚLTIMO segmento, então o split é
 *  pelo último separador -- um rowKey pode conter "::" (nomes livres). */
export function parseColumnKey(key: string): { rowKey: string; ordem: number } | null {
  const idx = key.lastIndexOf(KEY_SEP);
  if (idx === -1) return null;
  const tail = key.slice(idx + KEY_SEP.length);
  if (!/^-?\d+$/.test(tail)) return null; // Number('') === 0: exige dígitos explícitos
  const ordem = Number(tail);
  return { rowKey: key.slice(0, idx), ordem };
}

export function rowKeyFor(entity: BoardEntity, signatureRows: boolean): string {
  if (signatureRows) {
    const sig = stageSignature(entity.steps);
    return entity.templateId != null ? `template:${entity.templateId}#${sig}` : `custom#${sig}`;
  }
  return entity.templateId != null
    ? `template:${entity.templateId}`
    : entity.steps.map((s) => s.nome).join(' → ');
}

function rowLabelFor(
  entity: BoardEntity,
  key: string,
  templates: WorkflowTemplate[],
  signatureRows: boolean,
): string {
  const t =
    entity.templateId != null ? templates.find((t) => t.id === entity.templateId) : undefined;
  if (t) return t.nome.toUpperCase();
  if (!signatureRows) return key.toUpperCase();
  if (entity.kind === 'post' && entity.process.template_nome) {
    return entity.process.template_nome.toUpperCase();
  }
  return 'ETAPAS PERSONALIZADAS';
}

export function buildBoardRows(
  entities: BoardEntity[],
  templates: WorkflowTemplate[],
  opts: BuildBoardRowsOptions = {},
): BoardRow[] {
  const signatureRows = opts.signatureRows === true;
  const rowMap = new Map<
    string,
    { key: string; label: string; templateId: number | null; columns: Map<number, BoardColumn> }
  >();
  for (const entity of entities) {
    const key = rowKeyFor(entity, signatureRows);
    if (!rowMap.has(key)) {
      rowMap.set(key, {
        key,
        label: rowLabelFor(entity, key, templates, signatureRows),
        templateId: entity.templateId,
        columns: new Map(),
      });
    }
    const row = rowMap.get(key)!;
    // Garante a coluna de cada etapa desta entidade (templates evoluem; um card
    // pode ter uma etapa a mais). O nome e o tipo vêm da primeira entidade que
    // trouxe a ordem.
    for (const s of entity.steps) {
      if (!row.columns.has(s.ordem)) {
        row.columns.set(s.ordem, {
          ordem: s.ordem,
          nome: s.nome,
          tipo: s.tipo,
          cards: [],
          posts: [],
        });
      }
    }
    const col = row.columns.get(entity.etapaOrdem);
    if (!col) continue;
    if (entity.kind === 'workflow') col.cards.push(entity.card);
    else col.posts.push(entity);
  }
  const rows: BoardRow[] = [];
  for (const r of rowMap.values()) {
    const columns = [...r.columns.values()].sort((a, b) => a.ordem - b.ordem);
    for (const col of columns) {
      col.cards.sort((a, b) => (a.workflow.position ?? 0) - (b.workflow.position ?? 0));
      col.posts.sort((a, b) => a.posicao - b.posicao || entityNumericId(a) - entityNumericId(b));
    }
    if (columns.some((c) => c.cards.length > 0 || c.posts.length > 0))
      rows.push({ key: r.key, label: r.label, templateId: r.templateId, columns });
  }
  return rows;
}

/** Um card só pode ser solto numa coluna adjacente que exista na SUA própria
 *  sequência de etapas. Linhas por template aceitam fluxos com listas
 *  divergentes; a coluna de ordem 3 de outro fluxo não é alvo válido para um
 *  fluxo que só tem ordens 0..2. */
export function isValidDropTarget(
  allEtapas: { ordem: number }[],
  activeOrdem: number,
  targetOrdem: number,
): boolean {
  return (
    Math.abs(targetOrdem - activeOrdem) === 1 && allEtapas.some((e) => e.ordem === targetOrdem)
  );
}

/** Localiza a coluna de um card de fluxo (id = String(workflow.id)) ou de um
 *  post individual (id = 'post:<processId>', o mesmo id do useSortable). */
export function findCardColumn(
  cardId: string,
  rows: BoardRow[],
): { row: BoardRow; column: BoardColumn } | null {
  for (const row of rows) {
    for (const column of row.columns) {
      if (column.cards.some((c) => String(c.workflow.id) === cardId)) return { row, column };
      if (column.posts.some((p) => p.id === cardId)) return { row, column };
    }
  }
  return null;
}
