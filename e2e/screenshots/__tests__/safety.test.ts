import { describe, it, expect } from 'vitest';
import type { Page } from '@playwright/test';
import {
  isBlockedUrl,
  isSchedulingWrite,
  BLOCKED_FUNCTIONS,
  assertNoViolations,
  installSafetyNet,
} from '../safety';

const FN = 'https://xyz.supabase.co/functions/v1';
const REST = 'https://xyz.supabase.co/rest/v1';

describe('capture safety net', () => {
  it('blocks outward-facing edge functions', () => {
    expect(isBlockedUrl(`${FN}/instagram-publish`)).toBe(true);
    expect(isBlockedUrl(`${FN}/invite-user`)).toBe(true);
    expect(isBlockedUrl(`${FN}/billing-checkout`)).toBe(true);
    expect(isBlockedUrl(`${FN}/billing-portal`)).toBe(true);
    expect(isBlockedUrl(`${FN}/report-worker`)).toBe(true);
  });

  it('allows read paths needed for screenshots', () => {
    expect(isBlockedUrl(`${FN}/sign-r2-urls`)).toBe(false);
    expect(isBlockedUrl(`${FN}/hub-dashboard`)).toBe(false);
    expect(isBlockedUrl('https://xyz.supabase.co/rest/v1/clientes?select=*')).toBe(false);
  });

  it('does not blocklist by loose substring', () => {
    // instagram-publish-cron is cron-only and never called from the browser,
    // but a substring matcher would also catch e.g. a future
    // "instagram-publish-preview" read endpoint. Match the segment exactly.
    expect(isBlockedUrl(`${FN}/instagram-published-posts`)).toBe(false);
  });

  it('exposes the blocked list for documentation', () => {
    expect(BLOCKED_FUNCTIONS).toContain('instagram-publish');
  });

  it('assertNoViolations throws when a blocked call was attempted', () => {
    expect(() => assertNoViolations([`${FN}/instagram-publish`])).toThrow(/instagram-publish/);
  });

  it('assertNoViolations passes on a clean run', () => {
    expect(() => assertNoViolations([])).not.toThrow();
  });

  describe('path-aware sub-path blocking (Critical 2)', () => {
    it('blocks generate-report under the otherwise-allowed instagram-analytics function', () => {
      expect(isBlockedUrl(`${FN}/instagram-analytics/generate-report/42`)).toBe(true);
    });

    it('blocks send-report-email under instagram-analytics', () => {
      expect(isBlockedUrl(`${FN}/instagram-analytics/send-report-email?reportId=7`)).toBe(true);
    });

    it('still allows other instagram-analytics reads the analytics screenshots need', () => {
      expect(isBlockedUrl(`${FN}/instagram-analytics/demographics/42`)).toBe(false);
      expect(isBlockedUrl(`${FN}/instagram-analytics/best-times/42`)).toBe(false);
      expect(isBlockedUrl(`${FN}/instagram-analytics/ai-analysis/42`)).toBe(false);
      expect(isBlockedUrl(`${FN}/instagram-analytics/report-download/7`)).toBe(false);
    });

    it('does not blocklist instagram-analytics wholesale (no bare-function match)', () => {
      expect(isBlockedUrl(`${FN}/instagram-analytics`)).toBe(false);
    });
  });

  describe('isSchedulingWrite (Critical 1)', () => {
    it('blocks a PATCH to workflow_posts that sets status to agendado', () => {
      expect(
        isSchedulingWrite(`${REST}/workflow_posts?id=eq.5`, 'PATCH', { status: 'agendado' }),
      ).toBe(true);
    });

    it('blocks a PATCH to workflow_posts that sets scheduled_at', () => {
      expect(
        isSchedulingWrite(`${REST}/workflow_posts?id=eq.5`, 'PATCH', {
          scheduled_at: '2026-08-01T12:00:00.000Z',
        }),
      ).toBe(true);
    });

    it('blocks scheduling even via an insert (POST)', () => {
      expect(
        isSchedulingWrite(`${REST}/workflow_posts`, 'POST', { status: 'agendado' }),
      ).toBe(true);
    });

    it('allows unscheduling a post (scheduled_at: null)', () => {
      expect(
        isSchedulingWrite(`${REST}/workflow_posts?id=eq.5`, 'PATCH', { scheduled_at: null }),
      ).toBe(false);
    });

    it('allows other status transitions on workflow_posts', () => {
      expect(
        isSchedulingWrite(`${REST}/workflow_posts?id=eq.5`, 'PATCH', { status: 'postado' }),
      ).toBe(false);
      expect(
        isSchedulingWrite(`${REST}/workflow_posts?id=eq.5`, 'PATCH', {
          status: 'revisao_interna',
        }),
      ).toBe(false);
    });

    it('allows unrelated field writes on workflow_posts', () => {
      expect(
        isSchedulingWrite(`${REST}/workflow_posts?id=eq.5`, 'PATCH', { titulo: 'Novo titulo' }),
      ).toBe(false);
    });

    it('allows writes to other tables -- creating a client/transacao/fluxo is permitted', () => {
      expect(isSchedulingWrite(`${REST}/clientes`, 'POST', { nome: 'Cliente Teste' })).toBe(
        false,
      );
      expect(
        isSchedulingWrite(`${REST}/transacoes`, 'POST', { valor: 100, status: 'agendado' }),
      ).toBe(false);
      expect(isSchedulingWrite(`${REST}/workflows`, 'POST', { titulo: 'Fluxo Teste' })).toBe(
        false,
      );
    });

    it('ignores GET reads regardless of query shape', () => {
      expect(isSchedulingWrite(`${REST}/workflow_posts?status=eq.agendado`, 'GET', null)).toBe(
        false,
      );
    });

    it('is method-case-insensitive', () => {
      expect(
        isSchedulingWrite(`${REST}/workflow_posts?id=eq.5`, 'patch', { status: 'agendado' }),
      ).toBe(true);
    });
  });
});

/**
 * installSafetyNet itself was previously untested (Important 3): all
 * coverage above exercises the pure predicates only, so a swapped
 * route.abort() -> route.continue(), a mistyped glob, or a dropped `await`
 * would not fail any test. These tests drive installSafetyNet with a stub
 * Page whose `route()` just records the handler per glob, then invoke that
 * handler with a stub Route/Request to assert the real abort/continue and
 * violation-recording behavior.
 */
describe('installSafetyNet wiring', () => {
  type RouteHandler = (route: FakeRoute) => Promise<void> | void;

  function createFakePage() {
    const handlers = new Map<string, RouteHandler>();
    const page = {
      route: async (pattern: string, handler: RouteHandler) => {
        handlers.set(pattern, handler);
      },
    };
    return { page: page as unknown as Page, handlers };
  }

  interface FakeRoute {
    request: () => {
      url: () => string;
      method: () => string;
      postDataJSON: () => unknown;
    };
    abort: (reason?: string) => Promise<void>;
    continue: () => Promise<void>;
  }

  function createFakeRoute(url: string, method = 'GET', body: unknown = null) {
    const aborted: (string | undefined)[] = [];
    let continued = false;
    const route: FakeRoute = {
      request: () => ({
        url: () => url,
        method: () => method,
        postDataJSON: () => body,
      }),
      abort: async (reason?: string) => {
        aborted.push(reason);
      },
      continue: async () => {
        continued = true;
      },
    };
    return { route, aborted, wasContinued: () => continued };
  }

  it('registers handlers for both functions/v1 and rest/v1', async () => {
    const { page, handlers } = createFakePage();
    await installSafetyNet(page);
    expect(handlers.has('**/functions/v1/**')).toBe(true);
    expect(handlers.has('**/rest/v1/**')).toBe(true);
  });

  it('aborts and records a blocked edge-function call', async () => {
    const { page, handlers } = createFakePage();
    const violations = await installSafetyNet(page);
    const { route, aborted, wasContinued } = createFakeRoute(`${FN}/instagram-publish`);

    await handlers.get('**/functions/v1/**')!(route);

    expect(aborted).toHaveLength(1);
    expect(wasContinued()).toBe(false);
    expect(violations).toEqual([`${FN}/instagram-publish`]);
  });

  it('continues an allowed edge-function call', async () => {
    const { page, handlers } = createFakePage();
    const violations = await installSafetyNet(page);
    const { route, aborted, wasContinued } = createFakeRoute(`${FN}/hub-dashboard`);

    await handlers.get('**/functions/v1/**')!(route);

    expect(aborted).toHaveLength(0);
    expect(wasContinued()).toBe(true);
    expect(violations).toEqual([]);
  });

  it('aborts and records a blocked sub-path edge-function call', async () => {
    const { page, handlers } = createFakePage();
    const violations = await installSafetyNet(page);
    const { route, aborted } = createFakeRoute(`${FN}/instagram-analytics/generate-report/42`);

    await handlers.get('**/functions/v1/**')!(route);

    expect(aborted).toHaveLength(1);
    expect(violations).toEqual([`${FN}/instagram-analytics/generate-report/42`]);
  });

  it('aborts and records a scheduling REST write to workflow_posts', async () => {
    const { page, handlers } = createFakePage();
    const violations = await installSafetyNet(page);
    const { route, aborted, wasContinued } = createFakeRoute(
      `${REST}/workflow_posts?id=eq.5`,
      'PATCH',
      { status: 'agendado' },
    );

    await handlers.get('**/rest/v1/**')!(route);

    expect(aborted).toHaveLength(1);
    expect(wasContinued()).toBe(false);
    expect(violations).toEqual([`${REST}/workflow_posts?id=eq.5`]);
  });

  it('continues a permitted REST write, e.g. creating a client', async () => {
    const { page, handlers } = createFakePage();
    const violations = await installSafetyNet(page);
    const { route, aborted, wasContinued } = createFakeRoute(`${REST}/clientes`, 'POST', {
      nome: 'Cliente Teste',
    });

    await handlers.get('**/rest/v1/**')!(route);

    expect(aborted).toHaveLength(0);
    expect(wasContinued()).toBe(true);
    expect(violations).toEqual([]);
  });

  it('continues unscheduling a post through the live route handler', async () => {
    const { page, handlers } = createFakePage();
    const violations = await installSafetyNet(page);
    const { route, wasContinued } = createFakeRoute(`${REST}/workflow_posts?id=eq.5`, 'PATCH', {
      scheduled_at: null,
    });

    await handlers.get('**/rest/v1/**')!(route);

    expect(wasContinued()).toBe(true);
    expect(violations).toEqual([]);
  });

  it('continues a REST GET read even against workflow_posts', async () => {
    const { page, handlers } = createFakePage();
    const violations = await installSafetyNet(page);
    const { route, wasContinued } = createFakeRoute(
      `${REST}/workflow_posts?status=eq.agendado`,
      'GET',
    );

    await handlers.get('**/rest/v1/**')!(route);

    expect(wasContinued()).toBe(true);
    expect(violations).toEqual([]);
  });

  it('accumulates multiple violations across both route handlers', async () => {
    const { page, handlers } = createFakePage();
    const violations = await installSafetyNet(page);

    await handlers.get('**/functions/v1/**')!(createFakeRoute(`${FN}/invite-user`).route);
    await handlers.get('**/rest/v1/**')!(
      createFakeRoute(`${REST}/workflow_posts?id=eq.9`, 'PATCH', { status: 'agendado' }).route,
    );

    expect(violations).toEqual([`${FN}/invite-user`, `${REST}/workflow_posts?id=eq.9`]);
  });
});
