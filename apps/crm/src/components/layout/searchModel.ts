import { normalize } from '@/lib/normalizeText';
import { CATEGORY_LABELS } from '@/pages/ajuda/categoryConfig';
import type { KbSearchEntry } from '@/store/kb';

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
  meta: string;
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
  workflows: { id?: number; titulo: string; status?: string | null }[];
  posts: { id?: number; workflow_id: number | null; titulo: string; tipo?: string | null }[];
  ideias: { id?: number | string; titulo: string; clientes?: { nome?: string | null } | null }[];
  pages: { id?: number | string; title: string; cliente_id: number }[];
  articles: KbSearchEntry[];
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
      meta: w.status ?? '',
      route: `/entregas?drawer=${w.id}`,
      haystack: hay(w.titulo),
    }),
  );
  s.posts.forEach((p, i) => {
    const fluxo = p.workflow_id != null ? (fluxoTitulo.get(p.workflow_id) ?? '') : '';
    items.push({
      type: 'post',
      key: `post-${p.id ?? i}`,
      label: p.titulo,
      meta: p.workflow_id != null ? (p.tipo ?? '') : `${p.tipo ?? ''} · Avulso`,
      route: postHref(p),
      haystack: hay(p.titulo, fluxo),
    });
  });
  s.ideias.forEach((idea, i) =>
    items.push({
      type: 'ideia',
      key: `ideia-${idea.id ?? i}`,
      label: idea.titulo,
      meta: idea.clientes?.nome ?? '',
      route: '/ideias',
      haystack: hay(idea.titulo, idea.clientes?.nome),
    }),
  );
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
