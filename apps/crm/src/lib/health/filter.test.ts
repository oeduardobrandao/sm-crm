import { describe, it, expect } from 'vitest';
import { filterAndSortClients, matchesFilter } from './filter';
import type { ClientHealth } from '../../services/clientHealth';

const mk = (over: Partial<ClientHealth>): ClientHealth =>
  ({
    client_id: 1,
    client_name: 'X',
    client_sigla: 'X',
    client_cor: '#000',
    username: 'x',
    profile_picture_url: null,
    connected: true,
    follower_count: 0,
    follower_delta: 0,
    follower_delta_pct: 0,
    follower_series: [],
    engagement_rate: 0,
    reach_28d: 0,
    reach_trend_pct: 0,
    days_since_last_post: 0,
    pipeline: { agendados: 0, em_producao: 0, agente: 0, falha: 0 },
    authorization_status: 'active',
    token_expires_at: null,
    last_synced_at: null,
    status: 'estavel',
    score: 50,
    ...over,
  }) as ClientHealth;

describe('matchesFilter', () => {
  it('atencao groups em_queda/atencao/inativo', () => {
    expect(matchesFilter('em_queda', 'atencao')).toBe(true);
    expect(matchesFilter('inativo', 'atencao')).toBe(true);
    expect(matchesFilter('saudavel', 'atencao')).toBe(false);
  });
  it('conexao groups connection states', () => {
    expect(matchesFilter('reconectar', 'conexao')).toBe(true);
    expect(matchesFilter('desconectado', 'conexao')).toBe(true);
    expect(matchesFilter('em_alta', 'conexao')).toBe(false);
  });
  it('todos matches everything', () => {
    expect(matchesFilter('desconectado', 'todos')).toBe(true);
  });
});

describe('filterAndSortClients', () => {
  const list = [
    mk({
      client_id: 1,
      client_name: 'Bravo',
      status: 'saudavel',
      score: 70,
      engagement_rate: 2,
      follower_count: 100,
      days_since_last_post: 1,
    }),
    mk({
      client_id: 2,
      client_name: 'Alpha',
      status: 'em_queda',
      score: 10,
      engagement_rate: 5,
      follower_count: 300,
      days_since_last_post: 20,
    }),
    mk({
      client_id: 3,
      client_name: 'Charlie',
      status: 'reconectar',
      score: null,
      engagement_rate: 0,
      follower_count: 50,
      days_since_last_post: 5,
    }),
  ];

  it('search matches name and @username', () => {
    expect(
      filterAndSortClients(list, { filter: 'todos', search: 'alph', sort: 'nome' }),
    ).toHaveLength(1);
  });

  it('filter narrows to a status group', () => {
    const r = filterAndSortClients(list, { filter: 'atencao', search: '', sort: 'nome' });
    expect(r.map((c) => c.client_id)).toEqual([2]);
  });

  it('default sort (atencao) puts override states and low scores first', () => {
    const r = filterAndSortClients(list, { filter: 'todos', search: '', sort: 'atencao' });
    // reconectar (override, actionable) and em_queda (low score) before saudavel
    expect(r[r.length - 1].client_id).toBe(1); // saudavel last
  });

  it('sort by seguidores is descending', () => {
    const r = filterAndSortClients(list, { filter: 'todos', search: '', sort: 'seguidores' });
    expect(r.map((c) => c.follower_count)).toEqual([300, 100, 50]);
  });

  it('sort by nome is A–Z', () => {
    const r = filterAndSortClients(list, { filter: 'todos', search: '', sort: 'nome' });
    expect(r.map((c) => c.client_name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('search matches @username', () => {
    const testList = [mk({ client_id: 50, client_name: 'Nomatch', username: 'zebra' })];
    const r = filterAndSortClients(testList, { filter: 'todos', search: 'zeb', sort: 'nome' });
    expect(r).toHaveLength(1);
  });

  it('atencao sort: override states first, then score, then neutral-last', () => {
    const testList = [
      mk({ client_id: 1, status: 'saudavel', score: 70 }),
      mk({ client_id: 2, status: 'em_queda', score: 10 }),
      mk({ client_id: 3, status: 'reconectar', score: null }),
      mk({ client_id: 4, status: 'sincronizando', score: null }),
    ];
    const r = filterAndSortClients(testList, { filter: 'todos', search: '', sort: 'atencao' });
    expect(r.map((c) => c.client_id)).toEqual([3, 2, 1, 4]);
  });

  it('sort by engajamento is descending', () => {
    const r = filterAndSortClients(list, { filter: 'todos', search: '', sort: 'engajamento' });
    // id2: 5, id1: 2, id3: 0
    expect(r.map((c) => c.client_id)).toEqual([2, 1, 3]);
  });

  it('sort by ultimo_post: most stale first, nulls treated as most stale', () => {
    const testList = [
      mk({ client_id: 1, days_since_last_post: 1 }),
      mk({ client_id: 2, days_since_last_post: 20 }),
      mk({ client_id: 3, days_since_last_post: null }),
    ];
    const r = filterAndSortClients(testList, { filter: 'todos', search: '', sort: 'ultimo_post' });
    expect(r.map((c) => c.client_id)).toEqual([3, 2, 1]);
  });

  it('matchesFilter: saudaveis and estaveis groups', () => {
    expect(matchesFilter('em_alta', 'saudaveis')).toBe(true);
    expect(matchesFilter('estavel', 'saudaveis')).toBe(false);
    expect(matchesFilter('estavel', 'estaveis')).toBe(true);
    expect(matchesFilter('atencao', 'atencao')).toBe(true);
  });
});
