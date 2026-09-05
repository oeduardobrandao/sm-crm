// apps/admin/src/pages/__tests__/workspaces-params.test.ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PARAMS,
  hasActiveFilters,
  nextSort,
  parseWorkspacesParams,
  serializeWorkspacesParams,
  toListWorkspacesRequest,
  type WorkspacesListParams,
} from '../workspaces-params';

const FULL: WorkspacesListParams = {
  q: 'cl',
  plano: 'pro',
  status: 'pendente',
  overrides: 'sim',
  atividade: 'dormente',
  criado: '30d',
  ord: 'client_count',
  dir: 'asc',
  pag: 3,
  por: 50,
};

describe('workspaces-params', () => {
  it('round-trips a full param set', () => {
    const sp = serializeWorkspacesParams(FULL);
    expect(parseWorkspacesParams(sp)).toEqual(FULL);
  });

  it('omits defaults from the URL', () => {
    expect(serializeWorkspacesParams(DEFAULT_PARAMS).toString()).toBe('');
    expect(serializeWorkspacesParams({ ...DEFAULT_PARAMS, pag: 2 }).toString()).toBe('pag=2');
  });

  it('falls back to defaults on invalid values', () => {
    const sp = new URLSearchParams(
      'status=xyz&pag=abc&por=37&dir=sideways&ord=nope&atividade=x&criado=y&overrides=maybe',
    );
    expect(parseWorkspacesParams(sp)).toEqual(DEFAULT_PARAMS);
    expect(parseWorkspacesParams(new URLSearchParams('pag=0')).pag).toBe(1);
    expect(parseWorkspacesParams(new URLSearchParams('pag=-4')).pag).toBe(1);
  });

  it('maps to the API request with offset/limit and an absolute created_since', () => {
    const now = new Date('2026-09-04T12:00:00.000Z');
    expect(toListWorkspacesRequest(FULL, now)).toEqual({
      search: 'cl',
      plan_id: 'pro',
      status: 'pendente',
      has_overrides: true,
      activity: 'dormente',
      created_since: '2026-08-05T12:00:00.000Z',
      sort: 'client_count',
      dir: 'asc',
      offset: 100,
      limit: 50,
    });
  });

  it('omits empty filters from the request', () => {
    const now = new Date('2026-09-04T12:00:00.000Z');
    expect(toListWorkspacesRequest(DEFAULT_PARAMS, now)).toEqual({
      sort: 'created_at',
      dir: 'desc',
      offset: 0,
      limit: 20,
    });
    expect(
      toListWorkspacesRequest({ ...DEFAULT_PARAMS, overrides: 'nao' }, now).has_overrides,
    ).toBe(false);
  });

  it('hasActiveFilters ignores sort and paging', () => {
    expect(hasActiveFilters(DEFAULT_PARAMS)).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_PARAMS, pag: 4, ord: 'name', por: 100 })).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_PARAMS, q: 'a' })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_PARAMS, criado: '7d' })).toBe(true);
  });

  it('nextSort flips direction on the same key and uses the column default otherwise', () => {
    expect(nextSort({ ord: 'created_at', dir: 'desc' }, 'created_at')).toEqual({
      ord: 'created_at',
      dir: 'asc',
    });
    expect(nextSort({ ord: 'created_at', dir: 'desc' }, 'name')).toEqual({
      ord: 'name',
      dir: 'asc',
    });
    expect(nextSort({ ord: 'name', dir: 'asc' }, 'client_count')).toEqual({
      ord: 'client_count',
      dir: 'desc',
    });
  });
});
