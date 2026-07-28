import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type {
  CollectionMapping,
  Destination,
  ImportBundle,
  ImportCollection,
  ImportRow,
  MappingProposal,
} from '@mesaas/import-parsers';
import { buildCommitRows } from '../buildCommitRows';
import type {
  CommitClienteRow,
  CommitContainerRow,
  CommitEntregaRow,
  CommitIdeiaRow,
  CommitPostRow,
  CommitTemplateRow,
} from '@/services/dataImport';

// --- fixtures ---------------------------------------------------------------

function mkRow(key: string, over: Partial<ImportRow> = {}): ImportRow {
  return { key, cells: {}, ...over };
}

function mkCollection(id: string, over: Partial<ImportCollection> = {}): ImportCollection {
  return { id, name: id, source: 'csv', columns: ['Nome'], listNames: [], rows: [], ...over };
}

/** `count` dateless post rows with keys p1..pN and titles "Post 1".."Post N". */
function mkPostsCollection(
  id: string,
  count: number,
  over: Partial<ImportCollection> = {},
): ImportCollection {
  return mkCollection(id, {
    rows: Array.from({ length: count }, (_, i) =>
      mkRow(`p${i + 1}`, { cells: { Nome: `Post ${i + 1}` } }),
    ),
    ...over,
  });
}

function mkBundle(...collections: ImportCollection[]): ImportBundle {
  return { source: collections[0]?.source ?? 'csv', collections, warnings: [] };
}

function mkMapping(
  collectionId: string,
  destination: Destination,
  over: Partial<CollectionMapping> = {},
): CollectionMapping {
  return {
    collectionId,
    destination,
    columnRoles: { title: 'Nome' },
    statusMap: {},
    clientAssignment: { mode: 'fixed', clienteNome: '' },
    ...over,
  };
}

function mkProposal(...collections: CollectionMapping[]): MappingProposal {
  return { collections };
}

const ANA = { id: 3, nome: 'Ana' };

const byKind = <T>(rows: unknown[], kind: string) =>
  rows.filter((r) => (r as { kind: string }).kind === kind) as T[];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-27T12:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

// --- clientes ---------------------------------------------------------------

describe('clientes', () => {
  test('merges a roster row into an existing cliente, case- and accent-insensitively', () => {
    const bundle = mkBundle(
      mkCollection('roster', {
        columns: ['Nome', 'E-mail', 'Telefone', 'Valor'],
        rows: [
          mkRow('r1', {
            cells: {
              Nome: '  ANA SOUZA ',
              'E-mail': 'ana@x.com',
              Telefone: '11999',
              Valor: 'R$ 1.200,50',
            },
          }),
          mkRow('r2', { cells: { Nome: 'Bruno Lima', 'E-mail': '', Telefone: '', Valor: '' } }),
        ],
      }),
    );
    const proposal = mkProposal(
      mkMapping('roster', 'clientes', {
        columnRoles: {
          title: 'Nome',
          email: 'E-mail',
          phone: 'Telefone',
          monthlyValue: 'Valor',
        },
      }),
    );

    const rows = buildCommitRows(bundle, proposal, [{ id: 7, nome: 'Aná  Sóuza' }], null);

    expect(rows).toEqual([
      {
        kind: 'cliente',
        sourceKey: 'r1',
        nome: 'ANA SOUZA',
        email: 'ana@x.com',
        telefone: '11999',
        valorMensal: 1200.5,
        merge: { clienteId: 7 },
        provenance: {
          source: 'csv',
          collectionId: 'roster',
          sourceKey: 'r1',
          sourceUrl: null,
          cells: {
            Nome: '  ANA SOUZA ',
            'E-mail': 'ana@x.com',
            Telefone: '11999',
            Valor: 'R$ 1.200,50',
          },
        },
      },
      {
        kind: 'cliente',
        sourceKey: 'r2',
        nome: 'Bruno Lima',
        provenance: {
          source: 'csv',
          collectionId: 'roster',
          sourceKey: 'r2',
          sourceUrl: null,
          cells: { Nome: 'Bruno Lima', 'E-mail': '', Telefone: '', Valor: '' },
        },
      },
    ]);
  });

  test('parses a dot-decimal monthly value too, and drops an unparseable one', () => {
    const bundle = mkBundle(
      mkCollection('roster', {
        columns: ['Nome', 'Valor'],
        rows: [
          mkRow('r1', { cells: { Nome: 'A', Valor: '1,200.75' } }),
          mkRow('r2', { cells: { Nome: 'B', Valor: 'sob consulta' } }),
        ],
      }),
    );
    const proposal = mkProposal(
      mkMapping('roster', 'clientes', { columnRoles: { title: 'Nome', monthlyValue: 'Valor' } }),
    );

    const clientes = byKind<CommitClienteRow>(
      buildCommitRows(bundle, proposal, [], null),
      'cliente',
    );
    expect(clientes[0].valorMensal).toBe(1200.75);
    expect(clientes[1].valorMensal).toBeUndefined();
  });

  test('reads a pt-BR value with the cents omitted as thousands, not a decimal', () => {
    // A dot followed by exactly three digits, with no other separator in the
    // string, is a thousands mark ("1.500" is R$1500 — a very common shape
    // when a sheet skips cents), not a decimal point (which would read R$1,50).
    const values: [string, number][] = [
      ['1.500', 1500],
      ['1.200,50', 1200.5],
      ['1,500', 1500],
      ['1500', 1500],
      ['1.50', 1.5], // two digits after the dot -> an explicit decimal, not thousands
      ['1.234.567', 1234567], // repeated thousands separators
    ];
    for (const [raw, expected] of values) {
      const bundle = mkBundle(
        mkCollection('roster', {
          columns: ['Nome', 'Valor'],
          rows: [mkRow('r1', { cells: { Nome: 'A', Valor: raw } })],
        }),
      );
      const proposal = mkProposal(
        mkMapping('roster', 'clientes', { columnRoles: { title: 'Nome', monthlyValue: 'Valor' } }),
      );
      const clientes = byKind<CommitClienteRow>(
        buildCommitRows(bundle, proposal, [], null),
        'cliente',
      );
      expect(clientes[0].valorMensal).toBe(expected);
    }
  });

  test('skips roster rows with no usable name', () => {
    const bundle = mkBundle(
      mkCollection('roster', {
        rows: [mkRow('r1', { cells: { Nome: '   ' } }), mkRow('r2', { cells: { Nome: 'Ok' } })],
      }),
    );
    const rows = buildCommitRows(bundle, mkProposal(mkMapping('roster', 'clientes')), [], null);
    expect(rows.map((r) => r.sourceKey)).toEqual(['r2']);
  });

  test('synthesizes auto-clientes for names referenced only by post rows', () => {
    const bundle = mkBundle(
      mkCollection('cal', {
        columns: ['Nome', 'Cliente'],
        rows: [
          mkRow('p1', { cells: { Nome: 'Post 1', Cliente: 'Ana' } }),
          mkRow('p2', { cells: { Nome: 'Post 2', Cliente: 'Bruno' } }),
          mkRow('p3', { cells: { Nome: 'Post 3', Cliente: 'bruno' } }),
        ],
      }),
    );
    const proposal = mkProposal(
      mkMapping('cal', 'posts', {
        columnRoles: { title: 'Nome', client: 'Cliente' },
        clientAssignment: { mode: 'column', column: 'Cliente' },
      }),
    );

    const rows = buildCommitRows(bundle, proposal, [ANA], null);

    // Ana already exists -> no cliente row; Bruno is created once for both rows.
    expect(byKind<CommitClienteRow>(rows, 'cliente')).toEqual([
      { kind: 'cliente', sourceKey: 'auto-cliente:Bruno', nome: 'Bruno' },
    ]);
    expect(byKind<CommitContainerRow>(rows, 'container').map((c) => c.sourceKey)).toEqual([
      'container:existing-3:0',
      'container:created-auto-cliente:Bruno:0',
    ]);
    expect(byKind<CommitPostRow>(rows, 'post').map((p) => p.containerKey)).toEqual([
      'container:existing-3:0',
      'container:created-auto-cliente:Bruno:0',
      'container:created-auto-cliente:Bruno:0',
    ]);
  });

  test('reuses a roster row (not a new auto-cliente) for a name imported in this job', () => {
    const bundle = mkBundle(
      mkCollection('roster', { rows: [mkRow('r1', { cells: { Nome: 'Bruno Lima' } })] }),
      mkPostsCollection('cal', 1),
    );
    const proposal = mkProposal(
      mkMapping('roster', 'clientes'),
      mkMapping('cal', 'posts', {
        clientAssignment: { mode: 'fixed', clienteNome: 'bruno lima' },
      }),
    );

    const rows = buildCommitRows(bundle, proposal, [], null);

    expect(byKind<CommitClienteRow>(rows, 'cliente').map((c) => c.sourceKey)).toEqual(['r1']);
    expect(byKind<CommitContainerRow>(rows, 'container')[0]).toEqual({
      kind: 'container',
      sourceKey: 'container:created-r1:0',
      clienteRef: { type: 'created', sourceKey: 'r1' },
      titulo: 'Calendário importado — cal',
    });
  });

  test('skips rows whose client cannot be resolved', () => {
    const bundle = mkBundle(mkPostsCollection('cal', 2));
    const proposal = mkProposal(
      mkMapping('cal', 'posts', { clientAssignment: { mode: 'fixed', clienteNome: '  ' } }),
    );
    expect(buildCommitRows(bundle, proposal, [], null)).toEqual([]);
  });

  test('ignores collections mapped to "ignorar"', () => {
    const bundle = mkBundle(mkPostsCollection('cal', 2));
    const proposal = mkProposal(
      mkMapping('cal', 'ignorar', { clientAssignment: { mode: 'fixed', clienteNome: 'Ana' } }),
    );
    expect(buildCommitRows(bundle, proposal, [ANA], null)).toEqual([]);
  });
});

// --- posts ------------------------------------------------------------------

describe('posts', () => {
  test('chunks a client posts group into numbered containers at the cap', () => {
    const bundle = mkBundle(mkPostsCollection('cal', 5));
    const proposal = mkProposal(
      mkMapping('cal', 'posts', { clientAssignment: { mode: 'fixed', clienteNome: 'Ana' } }),
    );

    const rows = buildCommitRows(bundle, proposal, [ANA], 2);

    const containers = byKind<CommitContainerRow>(rows, 'container');
    expect(containers.map((c) => c.sourceKey)).toEqual([
      'container:existing-3:0',
      'container:existing-3:1',
      'container:existing-3:2',
    ]);
    expect(containers.map((c) => c.titulo)).toEqual([
      'Calendário importado — cal',
      'Calendário importado — cal (2)',
      'Calendário importado — cal (3)',
    ]);
    expect(containers.every((c) => c.clienteRef.type === 'existing')).toBe(true);
    expect(byKind<CommitPostRow>(rows, 'post').map((p) => p.containerKey)).toEqual([
      'container:existing-3:0',
      'container:existing-3:0',
      'container:existing-3:1',
      'container:existing-3:1',
      'container:existing-3:2',
    ]);
  });

  test('keeps one container per client when no cap applies', () => {
    const bundle = mkBundle(mkPostsCollection('cal', 5));
    const proposal = mkProposal(
      mkMapping('cal', 'posts', { clientAssignment: { mode: 'fixed', clienteNome: 'Ana' } }),
    );

    const rows = buildCommitRows(bundle, proposal, [ANA], null);
    expect(byKind<CommitContainerRow>(rows, 'container').map((c) => c.sourceKey)).toEqual([
      'container:existing-3:0',
    ]);
    expect(new Set(byKind<CommitPostRow>(rows, 'post').map((p) => p.containerKey))).toEqual(
      new Set(['container:existing-3:0']),
    );
  });

  test('numbers containers per client across collections so keys never collide', () => {
    const bundle = mkBundle(mkPostsCollection('jan', 1), mkPostsCollection('fev', 1));
    const proposal = mkProposal(
      mkMapping('jan', 'posts', { clientAssignment: { mode: 'fixed', clienteNome: 'Ana' } }),
      mkMapping('fev', 'posts', { clientAssignment: { mode: 'fixed', clienteNome: 'Ana' } }),
    );

    const containers = byKind<CommitContainerRow>(
      buildCommitRows(bundle, proposal, [ANA], null),
      'container',
    );
    // Keys stay globally unique per client (existing-3:0, existing-3:1), but
    // each collection is its own single chunk, so neither title gets a "(n)"
    // suffix — that suffix reflects THIS collection's chunk index, not the
    // cross-collection container counter.
    expect(containers.map((c) => [c.sourceKey, c.titulo])).toEqual([
      ['container:existing-3:0', 'Calendário importado — jan'],
      ['container:existing-3:1', 'Calendário importado — fev'],
    ]);
  });

  test('does not suffix the title when a client posts group lands exactly at the cap', () => {
    const bundle = mkBundle(mkPostsCollection('cal', 2));
    const proposal = mkProposal(
      mkMapping('cal', 'posts', { clientAssignment: { mode: 'fixed', clienteNome: 'Ana' } }),
    );

    const containers = byKind<CommitContainerRow>(
      buildCommitRows(bundle, proposal, [ANA], 2),
      'container',
    );
    expect(containers.map((c) => c.titulo)).toEqual(['Calendário importado — cal']);
    expect(byKind<CommitPostRow>(buildCommitRows(bundle, proposal, [ANA], 2), 'post')).toHaveLength(
      2,
    );
  });

  test('splits into two containers as soon as a client posts group exceeds the cap by one', () => {
    const bundle = mkBundle(mkPostsCollection('cal', 3));
    const proposal = mkProposal(
      mkMapping('cal', 'posts', { clientAssignment: { mode: 'fixed', clienteNome: 'Ana' } }),
    );

    const containers = byKind<CommitContainerRow>(
      buildCommitRows(bundle, proposal, [ANA], 2),
      'container',
    );
    expect(containers.map((c) => c.titulo)).toEqual([
      'Calendário importado — cal',
      'Calendário importado — cal (2)',
    ]);
  });

  test('emits a full post row with body, provenance and defaults', () => {
    const bundle = mkBundle(
      mkCollection('cal', {
        source: 'trello',
        columns: ['Nome', 'Formato'],
        rows: [
          mkRow('c1', {
            cells: { Nome: 'Post 1', Formato: 'Carrossel' },
            description: 'Linha 1',
            checklist: ['A', 'B'],
            sourceUrl: 'https://trello.com/c/abc',
          }),
        ],
      }),
    );
    const proposal = mkProposal(
      mkMapping('cal', 'posts', {
        columnRoles: { title: 'Nome', tipo: 'Formato' },
        clientAssignment: { mode: 'fixed', clienteNome: 'Ana' },
      }),
    );

    const post = byKind<CommitPostRow>(buildCommitRows(bundle, proposal, [ANA], null), 'post')[0];

    expect(post.titulo).toBe('Post 1');
    expect(post.tipo).toBe('carrossel');
    expect(post.status).toBe('rascunho');
    expect(post.scheduledAt).toBeNull();
    expect(post.publishedAt).toBeNull();
    expect(post.conteudoPlain).toBe('Linha 1\nA\nB');
    expect((post.conteudo as { type: string }).type).toBe('doc');
    expect(post.provenance).toEqual({
      source: 'trello',
      collectionId: 'cal',
      sourceKey: 'c1',
      sourceUrl: 'https://trello.com/c/abc',
      cells: { Nome: 'Post 1', Formato: 'Carrossel' },
    });
  });

  test('emits postado only for past-dated rows', () => {
    const bundle = mkBundle(
      mkCollection('cal', {
        listNames: ['Publicado'],
        rows: [
          mkRow('p1', {
            cells: { Nome: 'passado' },
            listName: 'Publicado',
            dueDate: '2026-07-01T10:00:00.000Z',
          }),
          mkRow('p2', {
            cells: { Nome: 'futuro' },
            listName: 'Publicado',
            dueDate: '2026-08-01T10:00:00.000Z',
          }),
          mkRow('p3', { cells: { Nome: 'sem data' }, listName: 'Publicado' }),
        ],
      }),
    );
    const proposal = mkProposal(
      mkMapping('cal', 'posts', {
        statusMap: { Publicado: 'postado' },
        clientAssignment: { mode: 'fixed', clienteNome: 'Ana' },
      }),
    );

    const posts = byKind<CommitPostRow>(buildCommitRows(bundle, proposal, [ANA], null), 'post');
    expect(posts.map((p) => [p.status, p.scheduledAt, p.publishedAt])).toEqual([
      ['postado', null, '2026-07-01T10:00:00.000Z'],
      ['aprovado_cliente', '2026-08-01T10:00:00.000Z', null],
      ['rascunho', null, null],
    ]);
  });

  test('keeps a date-independent status on a dateless row', () => {
    const bundle = mkBundle(
      mkCollection('cal', {
        listNames: ['Aprovado'],
        rows: [mkRow('p1', { cells: { Nome: 'x' }, listName: 'Aprovado' })],
      }),
    );
    const proposal = mkProposal(
      mkMapping('cal', 'posts', {
        statusMap: { Aprovado: 'aprovado_cliente' },
        clientAssignment: { mode: 'fixed', clienteNome: 'Ana' },
      }),
    );
    const post = byKind<CommitPostRow>(buildCommitRows(bundle, proposal, [ANA], null), 'post')[0];
    expect([post.status, post.scheduledAt, post.publishedAt]).toEqual([
      'aprovado_cliente',
      null,
      null,
    ]);
  });

  test('falls back to rascunho for unmapped and non-importable statuses', () => {
    const bundle = mkBundle(
      mkCollection('cal', {
        listNames: ['Agendado', 'Nunca visto'],
        rows: [
          mkRow('p1', { cells: { Nome: 'a' }, listName: 'Agendado' }),
          mkRow('p2', { cells: { Nome: 'b' }, listName: 'Nunca visto' }),
        ],
      }),
    );
    const proposal = mkProposal(
      mkMapping('cal', 'posts', {
        // 'agendado' is never importable — the publish crons claim on it.
        statusMap: { Agendado: 'agendado' } as unknown as CollectionMapping['statusMap'],
        clientAssignment: { mode: 'fixed', clienteNome: 'Ana' },
      }),
    );
    const posts = byKind<CommitPostRow>(buildCommitRows(bundle, proposal, [ANA], null), 'post');
    expect(posts.map((p) => p.status)).toEqual(['rascunho', 'rascunho']);
  });

  test('reads the status and date from mapped columns when the source has no lists', () => {
    const bundle = mkBundle(
      mkCollection('cal', {
        columns: ['Nome', 'Status', 'Data'],
        rows: [mkRow('p1', { cells: { Nome: 'x', Status: 'Aprovado', Data: '05/08/2026' } })],
      }),
    );
    const proposal = mkProposal(
      mkMapping('cal', 'posts', {
        columnRoles: { title: 'Nome', status: 'Status', date: 'Data' },
        statusMap: { Aprovado: 'aprovado_cliente' },
        clientAssignment: { mode: 'fixed', clienteNome: 'Ana' },
      }),
    );
    const post = byKind<CommitPostRow>(buildCommitRows(bundle, proposal, [ANA], null), 'post')[0];
    expect(post.status).toBe('aprovado_cliente');
    expect(post.scheduledAt).not.toBeNull();
    expect(new Date(post.scheduledAt!).getFullYear()).toBe(2026);
    expect(new Date(post.scheduledAt!).getMonth()).toBe(7); // August, dd/mm/yyyy
    expect(new Date(post.scheduledAt!).getDate()).toBe(5);
  });
});

// --- entregas ---------------------------------------------------------------

describe('entregas', () => {
  test('emits one template per collection and maps each card to its etapa index', () => {
    const bundle = mkBundle(
      mkCollection('board', {
        source: 'trello',
        name: 'Produção',
        listNames: ['Briefing', 'Design', 'Revisão'],
        rows: [
          mkRow('c1', {
            cells: { Nome: 'Card 1' },
            listName: 'Design',
            dueDate: '2026-08-10T00:00:00.000Z',
          }),
          mkRow('c2', { cells: { Nome: 'Card 2' }, listName: 'Fora do board' }),
        ],
      }),
    );
    const proposal = mkProposal(
      mkMapping('board', 'entregas', {
        clientAssignment: { mode: 'fixed', clienteNome: 'Ana' },
      }),
    );

    const rows = buildCommitRows(bundle, proposal, [ANA], null);

    expect(byKind<CommitTemplateRow>(rows, 'template')).toEqual([
      {
        kind: 'template',
        sourceKey: 'template:board',
        nome: 'Importado do Trello — Produção',
        etapas: ['Briefing', 'Design', 'Revisão'],
      },
    ]);
    expect(
      byKind<CommitEntregaRow>(rows, 'entrega').map((e) => [e.sourceKey, e.etapaIndex, e.dueDate]),
    ).toEqual([
      ['c1', 1, '2026-08-10T00:00:00.000Z'],
      ['c2', 0, null], // unknown list falls back to the first etapa
    ]);
    expect(byKind<CommitEntregaRow>(rows, 'entrega')[0].templateKey).toBe('template:board');
  });

  test('gives a listless entregas collection a single fallback etapa', () => {
    const bundle = mkBundle(
      mkCollection('board', { rows: [mkRow('c1', { cells: { Nome: 'Card' } })] }),
    );
    const proposal = mkProposal(
      mkMapping('board', 'entregas', { clientAssignment: { mode: 'fixed', clienteNome: 'Ana' } }),
    );
    const rows = buildCommitRows(bundle, proposal, [ANA], null);
    expect(byKind<CommitTemplateRow>(rows, 'template')[0].etapas).toEqual(['Importado']);
    expect(byKind<CommitEntregaRow>(rows, 'entrega')[0].etapaIndex).toBe(0);
  });
});

// --- ideias -----------------------------------------------------------------

describe('ideias', () => {
  test('uses the description, falling back to the remaining cells', () => {
    const bundle = mkBundle(
      mkCollection('banco', {
        columns: ['Nome', 'Notas', 'Fonte'],
        rows: [
          mkRow('i1', { cells: { Nome: 'Ideia 1', Notas: 'x', Fonte: '' }, description: 'Corpo' }),
          mkRow('i2', { cells: { Nome: 'Ideia 2', Notas: 'reels', Fonte: 'TikTok' } }),
        ],
      }),
    );
    const proposal = mkProposal(
      mkMapping('banco', 'ideias', { clientAssignment: { mode: 'fixed', clienteNome: 'Ana' } }),
    );

    const ideias = byKind<CommitIdeiaRow>(buildCommitRows(bundle, proposal, [ANA], null), 'ideia');
    expect(ideias.map((i) => [i.titulo, i.descricao])).toEqual([
      ['Ideia 1', 'Corpo'],
      ['Ideia 2', 'Notas: reels\nFonte: TikTok'],
    ]);
    expect(ideias[0].clienteRef).toEqual({ type: 'existing', clienteId: 3 });
  });
});

// --- ordering ---------------------------------------------------------------

describe('commit ordering', () => {
  test('emits clientes, then templates, then containers, then everything else', () => {
    const bundle = mkBundle(
      mkPostsCollection('cal', 1),
      mkCollection('banco', { rows: [mkRow('i1', { cells: { Nome: 'Ideia' } })] }),
      mkCollection('board', {
        listNames: ['A'],
        rows: [mkRow('c1', { cells: { Nome: 'Card' }, listName: 'A' })],
      }),
      mkCollection('roster', { rows: [mkRow('r1', { cells: { Nome: 'Ana' } })] }),
    );
    const fixed = { clientAssignment: { mode: 'fixed' as const, clienteNome: 'Ana' } };
    const proposal = mkProposal(
      mkMapping('cal', 'posts', fixed),
      mkMapping('banco', 'ideias', fixed),
      mkMapping('board', 'entregas', fixed),
      mkMapping('roster', 'clientes'),
    );

    const rows = buildCommitRows(bundle, proposal, [], null);

    expect(rows.map((r) => r.kind)).toEqual([
      'cliente',
      'template',
      'container',
      'post',
      'ideia',
      'entrega',
    ]);
    // Every reference resolves to a row emitted earlier in the array.
    const keys = rows.map((r) => r.sourceKey);
    const post = byKind<CommitPostRow>(rows, 'post')[0];
    const entrega = byKind<CommitEntregaRow>(rows, 'entrega')[0];
    expect(keys.indexOf(post.containerKey)).toBeLessThan(keys.indexOf(post.sourceKey));
    expect(keys.indexOf(entrega.templateKey)).toBeLessThan(keys.indexOf(entrega.sourceKey));
  });
});
