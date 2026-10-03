import { describe, expect, it } from 'vitest';
import {
  buildSearchItems,
  countByType,
  filterSearchItems,
  groupSearchItems,
  SEARCH_PREVIEW_LIMIT,
  SEARCH_TYPE_ORDER,
  type SearchSources,
} from '../searchModel';

const empty: SearchSources = {
  clientes: [],
  contratos: [],
  membros: [],
  transacoes: [],
  workflows: [],
  posts: [],
  tarefas: [],
  ideias: [],
  pages: [],
  articles: [],
};

function sources(over: Partial<SearchSources>): SearchSources {
  return { ...empty, ...over };
}

describe('buildSearchItems', () => {
  it('describes posts and fluxos with cliente, fluxo, tipo, status and dates', () => {
    const year = new Date().getFullYear();
    const items = buildSearchItems(
      sources({
        clientes: [{ id: 7, nome: 'Clínica Vida' }],
        workflows: [
          {
            id: 5,
            titulo: 'Julho',
            status: 'ativo',
            cliente_id: 7,
            created_at: `${year}-07-01T12:00:00`,
          },
        ],
        posts: [
          {
            id: 31,
            workflow_id: 5,
            cliente_id: 7,
            titulo: 'Carrossel',
            tipo: 'carrossel',
            status: 'revisao_interna',
            custom_status_id: 'def-1',
            scheduled_at: `${year}-10-12T14:00:00`,
            created_at: `${year}-10-02T09:00:00`,
          },
          {
            id: 42,
            workflow_id: null,
            cliente_id: 7,
            titulo: 'Fora de fluxo',
            tipo: 'feed',
            status: 'rascunho',
            created_at: '2025-03-04T09:00:00',
          },
        ],
        statusDefs: [
          {
            id: 'def-1',
            conta_id: 'c',
            nome: 'Revisão da Ana',
            cor: '#000',
            icone: null,
            behaves_as: 'revisao_interna',
            ordem: 0,
            arquivado: false,
            created_at: '',
            updated_at: '',
          },
        ],
      }),
    );

    const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
    expect(byKey['post-31'].details).toEqual([
      'Clínica Vida',
      'Julho',
      'Carrossel',
      'Revisão da Ana',
      'Publicação 12 out',
    ]);
    expect(byKey['post-31'].meta).toBe('Criado em 2 out');
    expect(byKey['post-42'].details).toEqual(['Clínica Vida', 'Avulso', 'Feed', 'Rascunho']);
    expect(byKey['post-42'].meta).toBe('Criado em 4 mar 2025');
    expect(byKey['fluxo-5'].details).toEqual(['Clínica Vida', 'Ativo']);
    expect(byKey['fluxo-5'].meta).toBe('Criado em 1 jul');
    // O nome do cliente aparece na tela, mas não entra no haystack do post.
    expect(byKey['post-31'].haystack).not.toContain('vida');
  });

  it('describes tarefas and ideias with cliente, status, people and dates', () => {
    const year = new Date().getFullYear();
    const items = buildSearchItems(
      sources({
        membros: [{ id: 3, nome: 'Ana' }],
        tarefas: [
          {
            id: 9,
            titulo: 'Revisar briefing',
            status: 'pendente',
            cliente_nome: 'Clínica Vida',
            responsavel_id: 3,
            data_limite: `${year}-10-15`,
            created_at: `${year}-10-01T10:00:00`,
          },
        ],
        ideias: [
          {
            id: 'i1',
            titulo: 'Reels de bastidores',
            clientes: { nome: 'Clínica Vida' },
            tipo: 'solicitacao',
            status: 'em_analise',
            origem: 'cliente',
            created_at: `${year}-09-20T10:00:00`,
          },
          {
            id: 'i2',
            titulo: 'Carrossel de mitos',
            clientes: { nome: 'Clínica Vida' },
            tipo: 'ideia',
            status: 'nova',
            origem: 'agencia',
            autor: { nome: 'Ana' },
          },
        ],
      }),
    );

    const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
    expect(byKey['tarefa-9'].route).toBe('/tarefas?tarefa=9');
    expect(byKey['tarefa-9'].details).toEqual(['Clínica Vida', 'A fazer', 'Ana', 'Prazo 15 out']);
    expect(byKey['tarefa-9'].meta).toBe('Criado em 1 out');
    expect(byKey['ideia-i1'].details).toEqual([
      'Clínica Vida',
      'Solicitação',
      'Em análise',
      'Enviada pelo cliente',
    ]);
    expect(byKey['ideia-i1'].meta).toBe('Criado em 20 set');
    expect(byKey['ideia-i1'].route).toBe('/ideias?ideia=i1');
    expect(byKey['ideia-i2'].details).toEqual(['Clínica Vida', 'Nova', 'Por Ana']);
    expect(byKey['ideia-i2'].meta).toBe('');
  });

  it('builds routes and metas per type, resolving fluxo and cliente names', () => {
    const items = buildSearchItems(
      sources({
        clientes: [{ id: 7, nome: 'Clínica Vida', email: 'oi@vida.com', sigla: 'CV' }],
        workflows: [{ id: 5, titulo: 'Julho', status: 'ativo' }],
        posts: [
          { id: 31, workflow_id: 5, titulo: 'Carrossel', tipo: 'carrossel' },
          { id: 42, workflow_id: null, titulo: 'Fora de fluxo', tipo: 'feed' },
        ],
        pages: [{ id: 'p1', title: 'Briefing', cliente_id: 7 }],
        articles: [
          {
            id: 'a1',
            title: 'Como conectar o Instagram',
            slug: 'como-conectar-o-instagram',
            excerpt: null,
            category: 'instagram-e-analytics',
            tags: ['meta'],
          },
        ],
      }),
    );

    const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
    expect(byKey['cliente-7'].route).toBe('/clientes/7');
    expect(byKey['post-31'].route).toBe('/entregas?drawer=5&post=31');
    expect(byKey['post-31'].haystack).toContain('julho');
    expect(byKey['post-42'].route).toBe('/entregas?post=42');
    expect(byKey['post-42'].details).toEqual(['Avulso', 'Feed']);
    expect(byKey['pagina-p1'].meta).toBe('Clínica Vida');
    expect(byKey['ajuda-a1'].route).toBe('/ajuda/como-conectar-o-instagram');
    expect(byKey['ajuda-a1'].meta).toBe('Instagram & Analytics');
    expect(byKey['ajuda-a1'].haystack).toContain('meta');
  });
});

describe('filterSearchItems', () => {
  const items = buildSearchItems(
    sources({
      clientes: [{ id: 1, nome: 'Dra. Marina Pacheco' }],
      posts: [
        { id: 1, workflow_id: null, titulo: 'Como eu cuido do sorriso do Henrique', tipo: 'reels' },
        { id: 2, workflow_id: null, titulo: 'Como postar no Instagram', tipo: 'feed' },
      ],
      articles: [
        {
          id: 'a1',
          title: 'Automação de comentários',
          slug: 'automacao',
          excerpt: null,
          category: 'automacoes',
          tags: [],
        },
      ],
    }),
  );

  it('returns nothing for an empty query', () => {
    expect(filterSearchItems(items, '')).toEqual([]);
    expect(filterSearchItems(items, '   ')).toEqual([]);
  });

  // The old cmdk fuzzy filter matched "como postar" against any title whose
  // letters appeared in that order; substring is what users expect.
  it('matches by substring only, not scattered letters', () => {
    expect(filterSearchItems(items, 'como postar').map((i) => i.label)).toEqual([
      'Como postar no Instagram',
    ]);
  });

  it('ignores accents on both sides', () => {
    expect(filterSearchItems(items, 'automacao')).toHaveLength(1);
    expect(filterSearchItems(items, 'Automação')).toHaveLength(1);
    expect(filterSearchItems(items, 'marina pacheco')).toHaveLength(1);
  });
});

describe('countByType / groupSearchItems', () => {
  const items = buildSearchItems(
    sources({
      clientes: [{ id: 1, nome: 'Post Cliente' }],
      posts: Array.from({ length: 7 }, (_, i) => ({
        id: i + 1,
        workflow_id: null,
        titulo: `Post ${i + 1}`,
        tipo: 'feed',
      })),
      articles: [
        {
          id: 'a1',
          title: 'Como agendar seu primeiro post',
          slug: 'primeiro-post',
          excerpt: null,
          category: 'primeiros-passos',
          tags: [],
        },
      ],
    }),
  );
  const matches = filterSearchItems(items, 'post');

  it('counts matches per type and in total', () => {
    expect(countByType(matches)).toEqual({ total: 9, cliente: 1, post: 7, ajuda: 1 });
  });

  it('in "all" mode caps each type at the preview limit, in fixed order, with the hidden count', () => {
    const groups = groupSearchItems(matches, 'all');
    expect(groups.map((g) => g.type)).toEqual(['cliente', 'post', 'ajuda']);
    expect(groups[1].items).toHaveLength(SEARCH_PREVIEW_LIMIT);
    expect(groups[1].hiddenCount).toBe(2);
    expect(groups[0].hiddenCount).toBe(0);
  });

  it('with a type selected shows only that type, uncapped', () => {
    const groups = groupSearchItems(matches, 'post');
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(7);
    expect(groups[0].hiddenCount).toBe(0);
  });

  it('keeps articles last in the type order', () => {
    expect(SEARCH_TYPE_ORDER[SEARCH_TYPE_ORDER.length - 1]).toBe('ajuda');
  });
});
