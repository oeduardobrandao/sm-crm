import { describe, expect, it, vi } from 'vitest';
// minhaFila.ts imports ASSIGNEE_PENDING_POST_STATUSES from the store (Task 2),
// which pulls the supabase client; the auto-mock keeps that import inert.
vi.mock('../../../lib/supabase');
import {
  FILA_BUCKET_ORDER,
  FILA_BUCKET_LABELS,
  filaBucketOf,
  margemOf,
  buildMinhaFila,
  compareScheduledAt,
  nextEtapaResponsavel,
} from '../minhaFila';
import type { DeadlineInfo } from '../etapaPrazo';
import { toPostEntity } from '../boardEntity';
import type { BoardCard } from '../hooks/useEntregasData';
import type { ActivePost, PostProcessWithPost, WorkflowEtapa } from '../../../store';

// Fixed "now": Wednesday 2026-09-23 10:00 local.
const NOW = new Date(2026, 8, 23, 10, 0, 0);
const OK: DeadlineInfo = { diasRestantes: 2, horasRestantes: 0, estourado: false, urgente: false };
const LATE: DeadlineInfo = {
  diasRestantes: -1,
  horasRestantes: 0,
  estourado: true,
  urgente: false,
};
/** Local date `n` days from NOW's day at hour `h`. */
const day = (n: number, h = 9) => new Date(2026, 8, 23 + n, h, 0, 0);

describe('FILA_BUCKET_ORDER', () => {
  it('has the six buckets in display order with pt-BR labels', () => {
    expect(FILA_BUCKET_ORDER).toEqual([
      'atrasado',
      'hoje',
      'amanha',
      'proximos7',
      'depois',
      'sem_prazo',
    ]);
    expect(FILA_BUCKET_LABELS.proximos7).toBe('Próximos 7 dias');
    expect(FILA_BUCKET_LABELS.sem_prazo).toBe('Sem prazo');
  });
});

describe('filaBucketOf', () => {
  it('estourado wins even when the deadline day is today', () => {
    expect(filaBucketOf(day(0, 23), LATE, NOW)).toBe('atrasado');
  });

  it('a deadline day in the past without estourado (stale cache) is still atrasado', () => {
    expect(filaBucketOf(day(-1), OK, NOW)).toBe('atrasado');
  });

  it('today is hoje regardless of the hour, tomorrow is amanha', () => {
    expect(filaBucketOf(day(0, 0), OK, NOW)).toBe('hoje');
    expect(filaBucketOf(day(0, 23), OK, NOW)).toBe('hoje');
    expect(filaBucketOf(day(1), OK, NOW)).toBe('amanha');
  });

  it('proximos7 is +2..+7 exclusive of hoje/amanha, depois is +8 and beyond', () => {
    expect(filaBucketOf(day(2), OK, NOW)).toBe('proximos7');
    expect(filaBucketOf(day(7), OK, NOW)).toBe('proximos7');
    expect(filaBucketOf(day(8), OK, NOW)).toBe('depois');
  });

  it('null prazoDate is sem_prazo, even when the fallback DeadlineInfo carries days', () => {
    expect(filaBucketOf(null, { ...OK, diasRestantes: 5 }, NOW)).toBe('sem_prazo');
  });

  it('bucketing at 23:59 gives the same answer as at 10:00 (local day, not ms)', () => {
    const lateNow = new Date(2026, 8, 23, 23, 59, 0);
    expect(filaBucketOf(day(1, 0), OK, lateNow)).toBe('amanha');
    expect(filaBucketOf(day(7, 23), OK, lateNow)).toBe('proximos7');
  });
});

describe('margemOf', () => {
  const prazo = new Date(2026, 8, 22, 23, 59);
  it('counts local calendar days between deadline and publish date, hours ignored', () => {
    expect(margemOf(new Date(2026, 8, 23, 8, 0).toISOString(), prazo)).toEqual({
      kind: 'dias',
      dias: 1,
    });
    expect(margemOf(new Date(2026, 8, 24, 8, 0).toISOString(), prazo)).toEqual({
      kind: 'dias',
      dias: 2,
    });
    expect(margemOf(new Date(2026, 8, 25, 8, 0).toISOString(), prazo)).toEqual({
      kind: 'dias',
      dias: 3,
    });
  });

  it('zero or negative days is sem_margem', () => {
    expect(margemOf(new Date(2026, 8, 22, 8, 0).toISOString(), prazo)).toEqual({
      kind: 'sem_margem',
      dias: 0,
    });
    expect(margemOf(new Date(2026, 8, 20, 8, 0).toISOString(), prazo)).toEqual({
      kind: 'sem_margem',
      dias: -2,
    });
  });

  it('no publish date is sem_data; no deadline is sem_prazo (checked first)', () => {
    expect(margemOf(null, prazo)).toEqual({ kind: 'sem_data' });
    expect(margemOf(new Date(2026, 8, 25).toISOString(), null)).toEqual({ kind: 'sem_prazo' });
    expect(margemOf(null, null)).toEqual({ kind: 'sem_prazo' });
  });
});

// ── Fixtures ────────────────────────────────────────────────────────────────

const ME = 7;
const OTHER = 9;
const iso = (n: number, h = 9) => day(n, h).toISOString();
/** 'YYYY-MM-DD' local, the etapa data_limite format. */
const ymd = (n: number) => {
  const d = day(n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function post(id: number, over: Partial<ActivePost> = {}): ActivePost {
  return {
    id,
    workflow_id: null,
    cliente_id: 1,
    cliente_nome: 'Cliente A',
    workflow_titulo: null,
    titulo: `Post ${id}`,
    tipo: 'feed',
    status: 'rascunho',
    custom_status_id: null,
    scheduled_at: null,
    published_at: null,
    ig_caption: null,
    instagram_permalink: null,
    publish_error: null,
    publish_error_code: null,
    ordem: 0,
    responsavel_id: null,
    platform: 'instagram',
    tiktok_publish_status: null,
    tiktok_publish_error: null,
    tiktok_post_url: null,
    instagram_media_id: null,
    ig_trial_strategy: null,
    board_ordem: null,
    ...over,
  } as ActivePost;
}

function etapa(over: Partial<WorkflowEtapa> & { workflow_id: number; ordem: number }): WorkflowEtapa {
  return {
    id: over.workflow_id * 100 + over.ordem,
    nome: `Etapa ${over.ordem}`,
    prazo_dias: 2,
    tipo_prazo: 'corridos',
    responsavel_id: null,
    tipo: 'padrao',
    status: over.ordem === 0 ? 'ativo' : 'pendente',
    iniciado_em: null,
    concluido_em: null,
    data_limite: null,
    ...over,
  };
}

/** Fluxo card: etapa ativa `ordem 0` com data_limite `dataLimiteDias` dias a
 *  partir de hoje (null = sem prazo), responsável `resp`; etapa seguinte com
 *  responsável `nextResp`. `deadline` é passado explícito porque getDeadlineInfo
 *  lê o relógio real. */
function card(opts: {
  wf: number;
  titulo?: string;
  resp: number | null;
  nextResp?: number | null;
  dataLimiteDias?: number | null;
  deadline?: DeadlineInfo;
}): BoardCard {
  const ativa = etapa({
    workflow_id: opts.wf,
    ordem: 0,
    nome: 'Design',
    responsavel_id: opts.resp,
    data_limite: opts.dataLimiteDias == null ? null : ymd(opts.dataLimiteDias),
  });
  const proxima = etapa({
    workflow_id: opts.wf,
    ordem: 1,
    nome: 'Revisão',
    responsavel_id: opts.nextResp ?? null,
  });
  return {
    workflow: {
      id: opts.wf,
      titulo: opts.titulo ?? `Fluxo ${opts.wf}`,
      cliente_id: 1,
      status: 'ativo',
      etapa_atual: 0,
    },
    etapa: ativa,
    cliente: { id: 1, nome: 'Cliente A' },
    membro: opts.resp === ME ? { id: ME, nome: 'Eu' } : undefined,
    deadline: opts.deadline ?? (opts.dataLimiteDias == null ? { ...OK, diasRestantes: 2 } : OK),
    totalEtapas: 2,
    etapaIdx: 0,
    allEtapas: [ativa, proxima],
  } as unknown as BoardCard;
}

/** Processo individual de um avulso: step ativa `ordem 0` (prazo_efetivo em
 *  `prazoDias` dias, null = sem prazo) com responsável `resp`; step seguinte
 *  `estado` (default pendente) com responsável `nextResp`. */
function processo(opts: {
  postId: number;
  resp: number | null;
  nextResp?: number | null;
  nextEstado?: 'pendente' | 'ignorado';
  prazoDias?: number | null;
}): PostProcessWithPost {
  const step = (ordem: number, extra: Record<string, unknown>) => ({
    id: opts.postId * 10 + ordem,
    conta_id: 'c',
    process_id: opts.postId,
    ordem,
    nome: ordem === 0 ? 'Copy' : 'Arte',
    tipo: 'padrao',
    responsavel_id: null,
    prazo_dias: null,
    tipo_prazo: null,
    prazo_efetivo: null,
    estado: 'pendente',
    iniciado_em: null,
    concluido_em: null,
    interrompido_em: null,
    origem_etapa_ordem: null,
    origem_etapa_nome: null,
    ...extra,
  });
  return {
    id: opts.postId,
    conta_id: 'c',
    post_id: opts.postId,
    template_id: null,
    template_nome: null,
    assinatura: '',
    origem_workflow_id: null,
    origem_descricao: null,
    estado: 'ativo',
    motivo_encerramento: null,
    etapa_atual: 0,
    modo_prazo: 'padrao',
    board_position: 0,
    revisao: 1,
    created_by: null,
    created_at: '2026-09-10T00:00:00Z',
    updated_at: '2026-09-10T00:00:00Z',
    concluido_em: null,
    steps: [
      step(0, {
        estado: 'ativo',
        responsavel_id: opts.resp,
        prazo_efetivo: opts.prazoDias == null ? null : iso(opts.prazoDias),
      }),
      step(1, { estado: opts.nextEstado ?? 'pendente', responsavel_id: opts.nextResp ?? null }),
    ],
    post: post(opts.postId),
  } as unknown as PostProcessWithPost;
}

const entityOf = (p: PostProcessWithPost) => toPostEntity(p, { clientes: [], membros: [] })!;

const ids = (fila: ReturnType<typeof buildMinhaFila>) => fila.items.map((i) => i.post.id);

// ── Inclusão ────────────────────────────────────────────────────────────────

describe('buildMinhaFila: inclusão', () => {
  it('etapa de fluxo comigo inclui os posts do fluxo, menos agendado e postado', () => {
    const c = card({ wf: 1, resp: ME, dataLimiteDias: 1 });
    const fila = buildMinhaFila(
      {
        cards: [c],
        posts: [
          post(1, { workflow_id: 1 }),
          post(2, { workflow_id: 1, status: 'agendado' }),
          post(3, { workflow_id: 1, status: 'postado' }),
          post(4, { workflow_id: 1, status: 'aprovado_cliente' }),
        ],
        postEntities: [],
      },
      ME,
      NOW,
    );
    expect(ids(fila)).toEqual([1, 4]);
    expect(fila.items.every((i) => i.origem === 'etapa')).toBe(true);
  });

  it('avulso com processo cuja step ativa é minha entra como etapa', () => {
    const p = processo({ postId: 5, resp: ME, prazoDias: 1 });
    const fila = buildMinhaFila(
      { cards: [], posts: [p.post], postEntities: [entityOf(p)] },
      ME,
      NOW,
    );
    expect(ids(fila)).toEqual([5]);
    expect(fila.items[0].origem).toBe('etapa');
    expect(fila.items[0].stage?.etapaNome).toBe('Copy');
  });

  it('responsável pelo post entra só nos quatro status pendentes', () => {
    const posts: ActivePost[] = [
      post(1, { responsavel_id: ME, status: 'rascunho' }),
      post(2, { responsavel_id: ME, status: 'revisao_interna' }),
      post(3, { responsavel_id: ME, status: 'correcao_cliente' }),
      post(4, { responsavel_id: ME, status: 'falha_publicacao' }),
      post(5, { responsavel_id: ME, status: 'aprovado_interno' }),
      post(6, { responsavel_id: ME, status: 'enviado_cliente' }),
      post(7, { responsavel_id: ME, status: 'aprovado_cliente' }),
      post(8, { responsavel_id: OTHER, status: 'rascunho' }),
    ];
    const fila = buildMinhaFila({ cards: [], posts, postEntities: [] }, ME, NOW);
    expect(ids(fila).sort()).toEqual([1, 2, 3, 4]);
    expect(fila.items.every((i) => i.origem === 'responsavel')).toBe(true);
  });

  it('post que casa nas duas regras aparece uma vez, como etapa', () => {
    const c = card({ wf: 1, resp: ME, dataLimiteDias: 1 });
    const fila = buildMinhaFila(
      { cards: [c], posts: [post(1, { workflow_id: 1, responsavel_id: ME })], postEntities: [] },
      ME,
      NOW,
    );
    expect(ids(fila)).toEqual([1]);
    expect(fila.items[0].origem).toBe('etapa');
  });

  it('status customizado com canônico postado sai (a coluna status já é o behaves_as)', () => {
    const c = card({ wf: 1, resp: ME, dataLimiteDias: 1 });
    const fila = buildMinhaFila(
      {
        cards: [c],
        posts: [post(1, { workflow_id: 1, status: 'postado', custom_status_id: 'abc' })],
        postEntities: [],
      },
      ME,
      NOW,
    );
    expect(ids(fila)).toEqual([]);
  });
});

// ── Prazo, bucket e fallback ────────────────────────────────────────────────

describe('buildMinhaFila: prazo da linha', () => {
  it('linha de etapa usa o prazo da etapa (bucket pela data, chip de margem por scheduled_at)', () => {
    const c = card({ wf: 1, resp: ME, dataLimiteDias: 1 });
    const fila = buildMinhaFila(
      { cards: [c], posts: [post(1, { workflow_id: 1, scheduled_at: iso(3) })], postEntities: [] },
      ME,
      NOW,
    );
    const item = fila.items[0];
    expect(item.bucket).toBe('amanha');
    expect(item.prazoOrigem).toBe('etapa');
    expect(item.margem).toEqual({ kind: 'dias', dias: 2 });
  });

  it('etapa de fluxo sem data (não iniciada) cai em sem_prazo mesmo com diasRestantes no fallback', () => {
    const c = card({ wf: 1, resp: ME, dataLimiteDias: null, deadline: { ...OK, diasRestantes: 5 } });
    const fila = buildMinhaFila(
      { cards: [c], posts: [post(1, { workflow_id: 1 })], postEntities: [] },
      ME,
      NOW,
    );
    expect(fila.items[0].bucket).toBe('sem_prazo');
    expect(fila.items[0].prazoDate).toBeNull();
    expect(fila.items[0].margem).toEqual({ kind: 'sem_prazo' });
  });

  it('responsável sem etapa cai em scheduled_at: bucket pela publicação, chip de margem omitido', () => {
    const fila = buildMinhaFila(
      {
        cards: [],
        posts: [
          post(1, { responsavel_id: ME, scheduled_at: iso(2) }),
          post(2, { responsavel_id: ME, scheduled_at: iso(-1) }),
          post(3, { responsavel_id: ME }),
        ],
        postEntities: [],
      },
      ME,
      NOW,
    );
    const by = (id: number) => fila.items.find((i) => i.post.id === id)!;
    expect(by(1).bucket).toBe('proximos7');
    expect(by(1).prazoOrigem).toBe('publicacao');
    expect(by(1).margem).toEqual({ kind: 'sem_prazo' });
    expect(by(2).bucket).toBe('atrasado');
    expect(by(2).deadline.estourado).toBe(true);
    expect(by(3).bucket).toBe('sem_prazo');
    expect(by(3).prazoOrigem).toBeNull();
  });

  it('responsável de um post cuja etapa (de outro membro) tem prazo usa o prazo da etapa', () => {
    const c = card({ wf: 1, resp: OTHER, dataLimiteDias: 0 });
    const fila = buildMinhaFila(
      {
        cards: [c],
        posts: [post(1, { workflow_id: 1, responsavel_id: ME, scheduled_at: iso(9) })],
        postEntities: [],
      },
      ME,
      NOW,
    );
    expect(fila.items[0].origem).toBe('responsavel');
    expect(fila.items[0].prazoOrigem).toBe('etapa');
    expect(fila.items[0].bucket).toBe('hoje');
    expect(fila.sections[1].groups[0].kind).toBe('fluxo');
  });
});

// ── Grupos e ordem ──────────────────────────────────────────────────────────

describe('buildMinhaFila: grupos e ordem', () => {
  it('posts do mesmo fluxo ficam num grupo, ordenados por scheduled_at nulls last e id', () => {
    const c = card({ wf: 1, resp: ME, dataLimiteDias: 1 });
    const fila = buildMinhaFila(
      {
        cards: [c],
        posts: [
          post(3, { workflow_id: 1 }),
          post(2, { workflow_id: 1, scheduled_at: iso(5) }),
          post(1, { workflow_id: 1, scheduled_at: iso(4) }),
          post(4, { workflow_id: 1 }),
        ],
        postEntities: [],
      },
      ME,
      NOW,
    );
    const amanha = fila.sections.find((s) => s.bucket === 'amanha')!;
    expect(amanha.groups).toHaveLength(1);
    expect(amanha.groups[0].key).toBe('fluxo:1');
    expect(amanha.groups[0].items.map((i) => i.post.id)).toEqual([1, 2, 3, 4]);
    expect(amanha.count).toBe(4);
    expect(ids(fila)).toEqual([1, 2, 3, 4]);
  });

  it('grupos ordenam por prazo asc (null último), depois menor scheduled_at, depois título', () => {
    const a = card({ wf: 1, titulo: 'Zeta', resp: ME, dataLimiteDias: 3 });
    const b = card({ wf: 2, titulo: 'Alfa', resp: ME, dataLimiteDias: 3 });
    const c = card({ wf: 3, titulo: 'Beta', resp: ME, dataLimiteDias: 2 });
    const fila = buildMinhaFila(
      {
        cards: [a, b, c],
        posts: [
          post(10, { workflow_id: 1, scheduled_at: iso(4) }),
          post(20, { workflow_id: 2, scheduled_at: iso(6) }),
          post(30, { workflow_id: 3 }),
          post(40, { responsavel_id: ME, scheduled_at: iso(5) }),
          post(50, { responsavel_id: ME }),
        ],
        postEntities: [],
      },
      ME,
      NOW,
    );
    const p7 = fila.sections.find((s) => s.bucket === 'proximos7')!;
    expect(p7.groups.map((g) => g.key)).toEqual(['fluxo:3', 'fluxo:1', 'fluxo:2', 'post:40']);
    expect(fila.sections.find((s) => s.bucket === 'sem_prazo')!.groups.map((g) => g.key)).toEqual([
      'post:50',
    ]);
  });

  it('sections sempre traz as 6 na ordem, top é items[0] e counts batem', () => {
    const c = card({ wf: 1, resp: ME, dataLimiteDias: 1, deadline: LATE });
    const fila = buildMinhaFila(
      {
        cards: [c],
        posts: [
          post(1, { workflow_id: 1 }),
          // h=11: depois de NOW (10h), senão vira 'atrasado' por instante já
          // passado (deadlineFromPrazoEfetivo trata scheduled_at como instante
          // exato) e quebra a asserção de atrasados: 1 abaixo.
          post(2, { responsavel_id: ME, scheduled_at: iso(0, 11) }),
        ],
        postEntities: [],
      },
      ME,
      NOW,
    );
    expect(fila.sections.map((s) => s.bucket)).toEqual(FILA_BUCKET_ORDER);
    expect(fila.top).toBe(fila.items[0]);
    expect(fila.top?.post.id).toBe(1);
    expect(fila.counts).toEqual({ total: 2, atrasados: 1 });
    const empty = buildMinhaFila({ cards: [], posts: [], postEntities: [] }, ME, NOW);
    expect(empty.top).toBeNull();
    expect(empty.sections.every((s) => s.count === 0)).toBe(true);
  });

  it('compareScheduledAt: asc, nulls last, id como desempate', () => {
    const rows = [
      { id: 3, scheduled_at: null },
      { id: 2, scheduled_at: iso(1) },
      { id: 1, scheduled_at: iso(1) },
      { id: 4, scheduled_at: iso(0) },
    ];
    expect([...rows].sort(compareScheduledAt).map((r) => r.id)).toEqual([4, 1, 2, 3]);
  });
});

// ── Chegando ────────────────────────────────────────────────────────────────

describe('buildMinhaFila: chegando', () => {
  it('próxima etapa do fluxo minha entra em chegando com etapa atual, responsável e chegaDate', () => {
    const c = card({ wf: 1, resp: OTHER, nextResp: ME, dataLimiteDias: 1 });
    const fila = buildMinhaFila(
      { cards: [c], posts: [post(1, { workflow_id: 1 })], postEntities: [] },
      ME,
      NOW,
    );
    expect(ids(fila)).toEqual([]);
    expect(fila.chegando).toHaveLength(1);
    expect(fila.chegando[0]).toMatchObject({
      etapaAtual: 'Design',
      responsavelAtual: '',
      proximaEtapa: 'Revisão',
    });
    expect(fila.chegando[0].chegaDate?.getDate()).toBe(day(1).getDate());
  });

  it('step pendente seguinte minha entra; step ignorado depois da ativa é pulada', () => {
    const ok = processo({ postId: 5, resp: OTHER, nextResp: ME, prazoDias: null });
    const skip = processo({ postId: 6, resp: OTHER, nextResp: ME, nextEstado: 'ignorado' });
    const fila = buildMinhaFila(
      {
        cards: [],
        posts: [ok.post, skip.post],
        postEntities: [entityOf(ok), entityOf(skip)],
      },
      ME,
      NOW,
    );
    expect(fila.chegando.map((c) => c.post.id)).toEqual([5]);
    expect(fila.chegando[0].chegaDate).toBeNull();
    expect(nextEtapaResponsavel(undefined, entityOf(skip))).toBeNull();
  });

  it('post já na fila e post agendado não entram em chegando', () => {
    const mine = card({ wf: 1, resp: ME, nextResp: ME, dataLimiteDias: 1 });
    const later = card({ wf: 2, resp: OTHER, nextResp: ME, dataLimiteDias: 1 });
    const fila = buildMinhaFila(
      {
        cards: [mine, later],
        posts: [post(1, { workflow_id: 1 }), post(2, { workflow_id: 2, status: 'agendado' })],
        postEntities: [],
      },
      ME,
      NOW,
    );
    expect(ids(fila)).toEqual([1]);
    expect(fila.chegando).toEqual([]);
  });

  it('ordena por scheduled_at, depois chegaDate, ambos nulls last, depois id', () => {
    const soon = card({ wf: 1, resp: OTHER, nextResp: ME, dataLimiteDias: 1 });
    const late = card({ wf: 2, resp: OTHER, nextResp: ME, dataLimiteDias: 4 });
    const none = card({ wf: 3, resp: OTHER, nextResp: ME, dataLimiteDias: null });
    const fila = buildMinhaFila(
      {
        cards: [soon, late, none],
        posts: [
          post(1, { workflow_id: 3 }),
          post(2, { workflow_id: 2 }),
          post(3, { workflow_id: 1 }),
          post(4, { workflow_id: 3, scheduled_at: iso(9) }),
          post(5, { workflow_id: 2, scheduled_at: iso(2) }),
        ],
        postEntities: [],
      },
      ME,
      NOW,
    );
    expect(fila.chegando.map((c) => c.post.id)).toEqual([5, 4, 3, 2, 1]);
  });
});
