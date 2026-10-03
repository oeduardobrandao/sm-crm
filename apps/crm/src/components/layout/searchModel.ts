import { normalize } from '@/lib/normalizeText';
import { CATEGORY_LABELS } from '@/pages/ajuda/categoryConfig';
import { TIPO_LABELS } from '@/pages/entregas/postLabels';
import { IDEIA_STATUS_LABELS } from '@/pages/ideias/ideiaLabels';
import { STATUS_LABELS as TAREFA_STATUS_LABELS } from '@/pages/tarefas/tarefasLogic';
import { buildStatusRegistry } from '@/pages/entregas/statusRegistry';
import { MESES_ABREV } from '@/utils/postDate';
import type { KbSearchEntry } from '@/store/kb';
import type { PostStatusDefinition } from '@/store/postStatuses';
import type { WorkflowPost } from '@/store/posts';
import type { TarefaStatus } from '@/store/tarefas';

/**
 * Modelo da busca global (⌘K). Puro: transforma os dados brutos do store em
 * itens tipados, filtra por substring sem acento e agrupa por tipo. O cmdk
 * roda com `shouldFilter={false}` e só cuida de teclado e seleção.
 */

export type SearchType =
  | 'cliente'
  | 'contrato'
  | 'membro'
  | 'transacao'
  | 'fluxo'
  | 'post'
  | 'tarefa'
  | 'ideia'
  | 'pagina'
  | 'ajuda';

/** Ordem fixa dos grupos e das pills; artigos por último. */
export const SEARCH_TYPE_ORDER: SearchType[] = [
  'cliente',
  'contrato',
  'membro',
  'transacao',
  'fluxo',
  'post',
  'tarefa',
  'ideia',
  'pagina',
  'ajuda',
];

export const SEARCH_TYPE_LABELS: Record<SearchType, string> = {
  cliente: 'Clientes',
  contrato: 'Contratos',
  membro: 'Equipe',
  transacao: 'Financeiro',
  fluxo: 'Fluxos',
  post: 'Postagens',
  tarefa: 'Tarefas',
  ideia: 'Ideias',
  pagina: 'Páginas',
  ajuda: 'Ajuda',
};

/** Máximo de itens por tipo no modo "Tudo". A pill do tipo mostra todos. */
export const SEARCH_PREVIEW_LIMIT = 5;

export interface SearchItem {
  type: SearchType;
  /** Único entre todos os itens; vira o `value`/`key` do cmdk. */
  key: string;
  label: string;
  /** Coluna da direita (curta: data, categoria, e-mail). */
  meta: string;
  /** Segunda linha, unida por " · " na tela: cliente, fluxo, tipo, status. */
  details?: string[];
  route: string;
  /** Texto normalizado onde a query é procurada. */
  haystack: string;
}

/** Formas mínimas dos dados que o diálogo já carrega; os tipos do store são supersets. */
export interface SearchSources {
  clientes: { id?: number; nome: string; email?: string | null; sigla?: string | null }[];
  contratos: { id?: number | string; titulo: string; cliente_nome?: string | null }[];
  membros: { id?: number | string; nome: string; cargo?: string | null }[];
  transacoes: {
    id?: number | string;
    descricao: string;
    categoria?: string | null;
    detalhe?: string | null;
  }[];
  workflows: {
    id?: number;
    titulo: string;
    status?: string | null;
    cliente_id?: number;
    created_at?: string;
  }[];
  posts: {
    id?: number;
    workflow_id: number | null;
    titulo: string;
    tipo?: WorkflowPost['tipo'] | null;
    cliente_id?: number;
    status?: WorkflowPost['status'];
    custom_status_id?: string | null;
    scheduled_at?: string | null;
    created_at?: string;
  }[];
  tarefas: {
    id?: number;
    titulo: string;
    status?: TarefaStatus;
    cliente_nome?: string | null;
    responsavel_id?: number | null;
    /** 'YYYY-MM-DD' */
    data_limite?: string | null;
    created_at?: string;
  }[];
  ideias: {
    id?: number | string;
    titulo: string;
    clientes?: { nome?: string | null } | null;
    tipo?: 'ideia' | 'solicitacao';
    status?: string;
    origem?: 'cliente' | 'agencia';
    autor?: { nome?: string | null } | null;
    created_at?: string;
  }[];
  pages: { id?: number | string; title: string; cliente_id: number }[];
  articles: KbSearchEntry[];
  /** Status personalizados do workspace; sem eles, o post mostra o status canônico. */
  statusDefs?: PostStatusDefinition[];
}

const FLUXO_STATUS_LABELS: Record<string, string> = {
  ativo: 'Ativo',
  concluido: 'Concluído',
  arquivado: 'Arquivado',
};

/** "2 out", ou "2 out 2025" fora do ano corrente. Vazio para data ausente/inválida. */
export function formatSearchDate(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const ano = d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : '';
  return `${d.getDate()} ${MESES_ABREV[d.getMonth()]}${ano}`;
}

function createdMeta(iso: string | null | undefined): string {
  const date = formatSearchDate(iso);
  return date ? `Criado em ${date}` : '';
}

function compact(parts: (string | null | undefined)[]): string[] {
  return parts.filter((part): part is string => Boolean(part));
}

/** Deep link for a post result: NULL workflow_id = post avulso (fora de
 *  fluxo), which opens via the universal `?post=` form instead of
 *  `?drawer=&post=`. */
export function postHref(p: { id?: number; workflow_id: number | null }): string {
  return p.workflow_id != null
    ? `/entregas?drawer=${p.workflow_id}&post=${p.id}`
    : `/entregas?post=${p.id}`;
}

function hay(...parts: (string | null | undefined)[]): string {
  return normalize(parts.filter(Boolean).join(' '));
}

export function buildSearchItems(s: SearchSources): SearchItem[] {
  const clienteNome = new Map<number, string>();
  for (const c of s.clientes) if (c.id != null) clienteNome.set(c.id, c.nome);
  const fluxoTitulo = new Map<number, string>();
  for (const w of s.workflows) if (w.id != null) fluxoTitulo.set(w.id, w.titulo);
  const membroNome = new Map<number | string, string>();
  for (const m of s.membros) if (m.id != null) membroNome.set(m.id, m.nome);
  const statusRegistry = buildStatusRegistry(s.statusDefs ?? []);

  const items: SearchItem[] = [];

  s.clientes.forEach((c, i) =>
    items.push({
      type: 'cliente',
      key: `cliente-${c.id ?? i}`,
      label: c.nome,
      meta: c.email ?? '',
      route: `/clientes/${c.id}`,
      haystack: hay(c.nome, c.email, c.sigla),
    }),
  );
  s.contratos.forEach((c, i) =>
    items.push({
      type: 'contrato',
      key: `contrato-${c.id ?? i}`,
      label: c.titulo,
      meta: c.cliente_nome ?? '',
      route: '/contratos',
      haystack: hay(c.titulo, c.cliente_nome),
    }),
  );
  s.membros.forEach((m, i) =>
    items.push({
      type: 'membro',
      key: `membro-${m.id ?? i}`,
      label: m.nome,
      meta: m.cargo ?? '',
      route: `/equipe/${m.id}`,
      haystack: hay(m.nome, m.cargo),
    }),
  );
  s.transacoes.forEach((t, i) =>
    items.push({
      type: 'transacao',
      key: `transacao-${t.id ?? i}`,
      label: t.descricao,
      meta: t.categoria ?? '',
      route: '/financeiro',
      haystack: hay(t.descricao, t.categoria, t.detalhe),
    }),
  );
  s.workflows.forEach((w, i) =>
    items.push({
      type: 'fluxo',
      key: `fluxo-${w.id ?? i}`,
      label: w.titulo,
      meta: createdMeta(w.created_at),
      details: compact([
        w.cliente_id != null ? clienteNome.get(w.cliente_id) : undefined,
        w.status ? (FLUXO_STATUS_LABELS[w.status] ?? w.status) : undefined,
      ]),
      route: `/entregas?drawer=${w.id}`,
      haystack: hay(w.titulo),
    }),
  );
  s.posts.forEach((p, i) => {
    const fluxo = p.workflow_id != null ? (fluxoTitulo.get(p.workflow_id) ?? '') : '';
    const publicacao = formatSearchDate(p.scheduled_at);
    items.push({
      type: 'post',
      key: `post-${p.id ?? i}`,
      label: p.titulo,
      meta: createdMeta(p.created_at),
      details: compact([
        p.cliente_id != null ? clienteNome.get(p.cliente_id) : undefined,
        p.workflow_id != null ? fluxo : 'Avulso',
        p.tipo ? (TIPO_LABELS[p.tipo] ?? p.tipo) : undefined,
        p.status
          ? statusRegistry.resolve({ status: p.status, custom_status_id: p.custom_status_id }).label
          : undefined,
        publicacao ? `Publicação ${publicacao}` : undefined,
      ]),
      route: postHref(p),
      haystack: hay(p.titulo, fluxo),
    });
  });
  s.tarefas.forEach((t, i) => {
    const prazo = t.data_limite ? formatSearchDate(`${t.data_limite}T00:00:00`) : '';
    const responsavel = t.responsavel_id != null ? membroNome.get(t.responsavel_id) : undefined;
    items.push({
      type: 'tarefa',
      key: `tarefa-${t.id ?? i}`,
      label: t.titulo,
      meta: createdMeta(t.created_at),
      details: compact([
        t.cliente_nome,
        t.status ? TAREFA_STATUS_LABELS[t.status] : undefined,
        responsavel,
        prazo ? `Prazo ${prazo}` : undefined,
      ]),
      route: `/tarefas?tarefa=${t.id}`,
      haystack: hay(t.titulo),
    });
  });
  s.ideias.forEach((idea, i) => {
    const autoria =
      idea.origem === 'cliente'
        ? 'Enviada pelo cliente'
        : idea.autor?.nome
          ? `Por ${idea.autor.nome}`
          : undefined;
    items.push({
      type: 'ideia',
      key: `ideia-${idea.id ?? i}`,
      label: idea.titulo,
      meta: createdMeta(idea.created_at),
      details: compact([
        idea.clientes?.nome,
        idea.tipo === 'solicitacao' ? 'Solicitação' : undefined,
        idea.status ? (IDEIA_STATUS_LABELS[idea.status] ?? idea.status) : undefined,
        autoria,
      ]),
      route: idea.id != null ? `/ideias?ideia=${encodeURIComponent(idea.id)}` : '/ideias',
      haystack: hay(idea.titulo, idea.clientes?.nome),
    });
  });
  s.pages.forEach((pg, i) => {
    const cliente = clienteNome.get(pg.cliente_id) ?? '';
    items.push({
      type: 'pagina',
      key: `pagina-${pg.id ?? i}`,
      label: pg.title,
      meta: cliente,
      route: `/clientes/${pg.cliente_id}`,
      haystack: hay(pg.title, cliente),
    });
  });
  s.articles.forEach((a) =>
    items.push({
      type: 'ajuda',
      key: `ajuda-${a.id}`,
      label: a.title,
      meta: CATEGORY_LABELS[a.category] ?? a.category,
      route: `/ajuda/${a.slug}`,
      haystack: hay(a.title, a.excerpt, ...a.tags),
    }),
  );

  return items;
}

/** Substring sem acento. Query vazia não retorna nada: a lista inicial é uma dica, não o banco inteiro. */
export function filterSearchItems(items: SearchItem[], query: string): SearchItem[] {
  const q = normalize(query.trim());
  if (!q) return [];
  return items.filter((item) => item.haystack.includes(q));
}

export type SearchCounts = Partial<Record<SearchType, number>> & { total: number };

export function countByType(items: SearchItem[]): SearchCounts {
  const counts: SearchCounts = { total: items.length };
  for (const item of items) counts[item.type] = (counts[item.type] ?? 0) + 1;
  return counts;
}

export interface SearchGroup {
  type: SearchType;
  items: SearchItem[];
  /** Quantos ficaram de fora pelo corte do modo "Tudo". */
  hiddenCount: number;
}

/**
 * Modo "Tudo" (`activeType` = 'all'): cada tipo mostra até SEARCH_PREVIEW_LIMIT
 * itens e informa quantos sobraram. Com um tipo selecionado: só ele, sem corte.
 */
export function groupSearchItems(
  items: SearchItem[],
  activeType: SearchType | 'all',
): SearchGroup[] {
  const groups: SearchGroup[] = [];
  for (const type of SEARCH_TYPE_ORDER) {
    if (activeType !== 'all' && type !== activeType) continue;
    const ofType = items.filter((item) => item.type === type);
    if (ofType.length === 0) continue;
    const shown = activeType === 'all' ? ofType.slice(0, SEARCH_PREVIEW_LIMIT) : ofType;
    groups.push({ type, items: shown, hiddenCount: ofType.length - shown.length });
  }
  return groups;
}
