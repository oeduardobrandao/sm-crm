import { i18n } from '@mesaas/i18n';
import type { WorkflowTemplate } from '../../store';
import type { BoardCard } from './hooks/useEntregasData';
import {
  entityNumericId,
  stageSignature,
  type BoardEntity,
  type PostEntity,
  type StageStep,
} from './boardEntity';

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
  /** Uppercase, as the classic tab strip shows it. */
  label: string;
  /** The same name as typed (the Vidro tab strip, which does not shout). */
  name: string;
  /** Template da linha, para o botão "Novo fluxo" da primeira coluna. */
  templateId: number | null;
  /** Ordenadas por `ordem` ascendente. */
  columns: BoardColumn[];
}

export interface BuildBoardRowsOptions {
  /** Spec §4.1, corrigida: a assinatura ordenada das etapas entra na chave
   *  apenas das linhas SEM template (`custom#<assinatura>`), onde substitui os
   *  nomes unidos. Com template a chave continua sendo só `template:<id>`.
   *
   *  A spec original punha a assinatura na chave dos dois casos, para que
   *  "snapshots divergentes do mesmo template virassem linhas próprias". Na
   *  prática isso produzia duas (ou mais) abas com o MESMO rótulo — o nome do
   *  template —, indistinguíveis de um template duplicado, e divergir é a
   *  norma e não a exceção: `update_workflow_template` só atualiza etapas
   *  `pendente`/`ativo` (e só campos que o fluxo herdou do template), então
   *  editar um template forka para sempre a
   *  assinatura de todo fluxo que já tenha uma etapa concluída. As colunas
   *  fazem união das etapas (pelo nome, ver workflowColumnOrdens) e
   *  workflowDropDirection valida contra as etapas do próprio card, então a
   *  linha por template comporta os divergentes.
   *
   *  Ligado pela feature_post_processes; desligado, a chave sem template é a
   *  de sempre (nomes unidos), byte a byte. */
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
  if (entity.templateId != null) return `template:${entity.templateId}`;
  return signatureRows
    ? `custom#${stageSignature(entity.steps)}`
    : entity.steps.map((s) => s.nome).join(' → ');
}

function rowNameFor(
  entity: BoardEntity,
  key: string,
  templates: WorkflowTemplate[],
  signatureRows: boolean,
): string {
  const t =
    entity.templateId != null ? templates.find((t) => t.id === entity.templateId) : undefined;
  if (t) return t.nome;
  if (!signatureRows) return key;
  if (entity.kind === 'post' && entity.process.template_nome) {
    return entity.process.template_nome;
  }
  return i18n.t('entregas:boardRows.customEtapas');
}

export function buildBoardRows(
  entities: BoardEntity[],
  templates: WorkflowTemplate[],
  opts: BuildBoardRowsOptions = {},
): BoardRow[] {
  const signatureRows = opts.signatureRows === true;
  const rowMap = new Map<
    string,
    {
      key: string;
      label: string;
      name: string;
      templateId: number | null;
      tplEtapas: readonly { nome: string }[] | undefined;
      columns: Map<number, BoardColumn>;
    }
  >();
  for (const entity of entities) {
    const key = rowKeyFor(entity, signatureRows);
    if (!rowMap.has(key)) {
      // Colunas da linha de um template nascem das etapas do TEMPLATE, não do
      // primeiro card visto: a linha é do template e snapshots divergentes
      // convivem nela, então o cabeçalho tem que ser a versão corrente do
      // template. Etapas que só o card tem entram depois, pelo laço abaixo.
      const tpl =
        entity.templateId != null ? templates.find((t) => t.id === entity.templateId) : undefined;
      const name = rowNameFor(entity, key, templates, signatureRows);
      rowMap.set(key, {
        key,
        label: name.toUpperCase(),
        name,
        templateId: entity.templateId,
        tplEtapas: tpl?.etapas,
        columns: new Map(
          (tpl?.etapas ?? []).map((e, i) => [
            i,
            { ordem: i, nome: e.nome, tipo: e.tipo ?? 'padrao', cards: [], posts: [] },
          ]),
        ),
      });
    }
    const row = rowMap.get(key)!;
    // Fluxo: coluna pelo nome da etapa (workflowColumnOrdens). Post: pela ordem.
    const colOf =
      entity.kind === 'workflow' ? workflowColumnOrdens(row.tplEtapas, entity.steps) : undefined;
    // Garante a coluna de cada etapa desta entidade (templates evoluem; um card
    // pode ter uma etapa a mais). O nome e o tipo vêm da primeira entidade que
    // trouxe a ordem.
    for (const s of entity.steps) {
      const ordem = colOf?.get(s.ordem) ?? s.ordem;
      // A coluna própria (ordem + 0,5) de uma etapa que saiu do template só
      // aparece enquanto a etapa não está feita: concluída, seria uma coluna
      // vazia que sobra no quadro depois de o usuário tirar a etapa.
      if (
        entity.kind === 'workflow' &&
        !Number.isInteger(ordem) &&
        entity.card.allEtapas.find((e) => e.ordem === s.ordem)?.status === 'concluido'
      ) {
        continue;
      }
      if (!row.columns.has(ordem)) {
        row.columns.set(ordem, {
          ordem,
          nome: s.nome,
          tipo: s.tipo,
          cards: [],
          posts: [],
        });
      }
    }
    const col = row.columns.get(colOf?.get(entity.etapaOrdem) ?? entity.etapaOrdem);
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
      rows.push({ key: r.key, label: r.label, name: r.name, templateId: r.templateId, columns });
  }
  // Every template gets a tab, even one with zero active fluxos right now (e.g. a
  // freshly created template, or the "Padrão" template seeded on signup) — otherwise
  // it's invisible until someone starts a fluxo from it.
  const templateIdsWithRows = new Set(
    rows.filter((r) => r.templateId != null).map((r) => r.templateId),
  );
  for (const t of templates) {
    if (t.id == null || templateIdsWithRows.has(t.id)) continue;
    const steps: StageStep[] = t.etapas.map((e, i) => ({
      ordem: i,
      nome: e.nome,
      tipo: e.tipo ?? 'padrao',
    }));
    rows.push({
      key: `template:${t.id}`,
      label: t.nome.toUpperCase(),
      name: t.nome,
      templateId: t.id,
      columns: steps.map((s) => ({
        ordem: s.ordem,
        nome: s.nome,
        tipo: s.tipo,
        cards: [],
        posts: [],
      })),
    });
  }
  return rows;
}

/** Coluna de cada etapa de um fluxo numa linha (step.ordem -> ordem da coluna).
 *  update_workflow_template casa as etapas pelo nome, então um fluxo pode guardar
 *  uma etapa que o template perdeu (feita, ativa ou com histórico) e ficar com as
 *  seguintes uma ordem à frente do template. Cada etapa vai para a coluna do
 *  template com o mesmo nome (aparado), quando só uma coluna tem esse nome. Sem
 *  par, fica na própria ordem (nome customizado no fluxo, nome repetido no
 *  template); se essa coluna já é de outra etapa do fluxo, ganha uma coluna
 *  própria logo depois da etapa anterior (ordem + 0,5). Sem template, é a ordem. */
export function workflowColumnOrdens(
  templateEtapas: readonly { nome: string }[] | undefined,
  steps: readonly { ordem: number; nome: string }[],
): Map<number, number> {
  const sorted = [...steps].sort((a, b) => a.ordem - b.ordem);
  const out = new Map<number, number>();
  if (!templateEtapas?.length) {
    for (const s of sorted) out.set(s.ordem, s.ordem);
    return out;
  }
  const indexByNome = new Map<string, number | null>();
  templateEtapas.forEach((e, i) => {
    const nome = (e.nome ?? '').trim();
    indexByNome.set(nome, indexByNome.has(nome) ? null : i);
  });
  const matched = new Map<number, number>();
  const taken = new Set<number>();
  for (const s of sorted) {
    const i = indexByNome.get(s.nome.trim());
    if (i != null && !taken.has(i)) {
      matched.set(s.ordem, i);
      taken.add(i);
    }
  }
  let prev = -1;
  for (const s of sorted) {
    const col = matched.get(s.ordem) ?? (taken.has(s.ordem) ? prev + 0.5 : s.ordem);
    out.set(s.ordem, col);
    prev = col;
  }
  return out;
}

/** Arrastar um fluxo: a coluna da etapa seguinte do PRÓPRIO fluxo avança, a da
 *  anterior volta (as ações andam pela sequência do fluxo), nas colunas de
 *  workflowColumnOrdens. Qualquer outra coluna não é alvo. */
export function workflowDropDirection(
  templateEtapas: readonly { nome: string }[] | undefined,
  steps: readonly { ordem: number; nome: string }[],
  activeOrdem: number,
  targetColumnOrdem: number,
): 'forward' | 'back' | null {
  const sorted = [...steps].sort((a, b) => a.ordem - b.ordem);
  const idx = sorted.findIndex((s) => s.ordem === activeOrdem);
  if (idx < 0) return null;
  const colOf = workflowColumnOrdens(templateEtapas, sorted);
  const next = sorted[idx + 1];
  const prev = sorted[idx - 1];
  if (next && colOf.get(next.ordem) === targetColumnOrdem) return 'forward';
  if (prev && colOf.get(prev.ordem) === targetColumnOrdem) return 'back';
  return null;
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
