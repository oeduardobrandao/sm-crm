import { describe, it, expect, vi, beforeEach } from 'vitest';

// See membership.test.ts / hubBranding.test.ts for why vi.hoisted() is required
// here: the '../hub' import below pulls in '../core', which runs this factory
// before any plain top-level const in this file would be initialized.
const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}));

vi.mock('../core', () => ({
  supabase: { from: mockFrom },
  getContaId: vi.fn(),
  getCurrentProfile: vi.fn(),
  clearProfileCache: vi.fn(),
  getUserId: vi.fn(),
}));

import { getPortalFill } from '../hub';

interface LegResult {
  data?: unknown;
  count?: number | null;
  error?: unknown;
}

/**
 * One stub per `supabase.from(...)` call, chainable like the real PostgREST
 * builder -- `select`/`eq`/`not`/`neq`/`is` all return the same object -- and
 * awaitable directly. `getPortalFill`'s `countOf` helper does
 * `await apply(supabase.from(...)...)` with no trailing `.then()` for five of
 * its six queries, so the stub itself has to be a thenable, not just carry a
 * `maybeSingle()` (which the sixth, un-countOf'd hub_brand lookup does call).
 */
function makeBuilder(result: LegResult) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    not: vi.fn(() => builder),
    neq: vi.fn(() => builder),
    is: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (onResolve: (value: LegResult) => unknown, onReject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(onResolve, onReject),
  };
  return builder;
}

type Builder = ReturnType<typeof makeBuilder>;

/**
 * getPortalFill fires its six queries -- in this fixed order -- inside one
 * Promise.all: briefingTotal, briefingAnswered, brandFiles, pages,
 * newIdeasWithoutReply, then the un-countOf'd hub_brand lookup last. Each call
 * builds its whole chain synchronously (the mock's chain methods return the
 * builder itself, not a promise) before hitting its first real `await`, so
 * `mockFrom` sees the six calls in that exact order -- queueing one result per
 * call reproduces it without branching on table name or filters applied.
 */
function queueLegs(results: LegResult[]): Builder[] {
  const builders: Builder[] = [];
  let call = 0;
  mockFrom.mockImplementation(() => {
    const builder = makeBuilder(results[call] ?? { count: 0, error: null });
    builders.push(builder);
    call += 1;
    return builder;
  });
  return builders;
}

const okLegs = (): LegResult[] => [
  { count: 3, error: null }, // briefingTotal
  { count: 2, error: null }, // briefingAnswered
  { count: 1, error: null }, // brandFiles
  { count: 4, error: null }, // pages
  { count: 0, error: null }, // newIdeasWithoutReply
  { data: null, error: null }, // hub_brand
];

describe('getPortalFill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves the six counts plus hasBrand for a clean run', async () => {
    queueLegs(okLegs());
    await expect(getPortalFill(1)).resolves.toEqual({
      briefingTotal: 3,
      briefingAnswered: 2,
      brandFiles: 1,
      pages: 4,
      newIdeasWithoutReply: 0,
      hasBrand: false,
    });
  });

  it('chains .not("answer", "is", null) then .neq("answer", "") for the answered-briefing count', async () => {
    const builders = queueLegs(okLegs());
    await getPortalFill(1);

    const answeredBuilder = builders[1];
    expect(answeredBuilder.not).toHaveBeenCalledWith('answer', 'is', null);
    expect(answeredBuilder.neq).toHaveBeenCalledWith('answer', '');
  });

  it('chains .eq("status", "nova") and .is("comentario_agencia", null) for the new-ideas count', async () => {
    const builders = queueLegs(okLegs());
    await getPortalFill(1);

    const ideasBuilder = builders[4];
    expect(ideasBuilder.eq).toHaveBeenCalledWith('status', 'nova');
    expect(ideasBuilder.is).toHaveBeenCalledWith('comentario_agencia', null);
  });

  // Each of the six underlying queries must leave getPortalFill's result
  // inconclusive (rejected), never coerced to a zero/false default -- that's
  // what lets AcessoPage show a dash instead of misreporting "vazia". The
  // hub_brand leg (index 5) is the one the brief's own snippet left unguarded;
  // hub.ts:275 hardens it, and this table makes sure that stays true.
  const legNames = [
    'briefingTotal',
    'briefingAnswered',
    'brandFiles',
    'pages',
    'newIdeasWithoutReply',
    'hub_brand',
  ] as const;

  it.each(legNames.map((name, index) => [name, index] as const))(
    'rejects with the raw error when the %s query errors',
    async (_name, index) => {
      const err = { message: 'boom' };
      const legs = okLegs();
      legs[index] = index === 5 ? { data: null, error: err } : { count: null, error: err };
      queueLegs(legs);

      await expect(getPortalFill(1)).rejects.toBe(err);
    },
  );
});
