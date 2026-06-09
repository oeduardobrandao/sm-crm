import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildSpec } from './write-spec.mjs';

const payload = { cron_name: 'report-worker', signature: 'report-worker:boom', signature_hash: 'abc123', error_message: 'boom', errors: [{ accountId: '42', error: 'boom' }], occurred_at: '2026-06-09T00:00:00Z' };
const context = { cronName: 'report-worker', files: [{ path: 'supabase/functions/report-worker/index.ts', content: 'export const x = 1;' }] };

afterEach(() => vi.restoreAllMocks());

describe('buildSpec', () => {
  it('returns the Groq title+body on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ title: '[cron-triage] report-worker: boom', body: '## Root cause\nx' }) } }] }), { status: 200 })));
    const out = await buildSpec(payload, context, 'test-key');
    expect(out.title).toContain('report-worker');
    expect(out.body).toContain('Root cause');
  });
  it('falls back to a raw report when Groq errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 })));
    const out = await buildSpec(payload, context, 'test-key');
    expect(out.title).toContain('report-worker');
    expect(out.body).toContain('42'); // raw error preserved in fallback
  });
  it('falls back when no API key', async () => {
    const out = await buildSpec(payload, context, '');
    expect(out.body).toContain('boom');
  });
});
