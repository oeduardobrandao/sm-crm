import { assertEquals } from './assert.ts';
import { cursorOf, parseCursor, parseGetMode, shellCutoff } from '../hub-posts/modes.ts';

const q = (s: string) => new URLSearchParams(s);

Deno.test('hub-posts modes: no params is the shell', () => {
  assertEquals(parseGetMode(q('token=t')), { kind: 'shell' });
});

Deno.test('hub-posts modes: cutoff is the start of the UTC day 90 days back', () => {
  assertEquals(shellCutoff('2026-10-02T23:59:59.999Z'), '2026-07-04T00:00:00.000Z');
  assertEquals(shellCutoff('2026-10-02T00:00:00.000Z'), '2026-07-04T00:00:00.000Z');
});

Deno.test('hub-posts modes: cursor keeps PostgREST microseconds byte for byte', () => {
  const row = { published_at: '2026-07-04T10:00:00.123456+00:00', id: 42 };
  const raw = cursorOf(row);
  assertEquals(raw, '2026-07-04T10:00:00.123456+00:00|42');
  assertEquals(parseCursor(raw), { ts: '2026-07-04T10:00:00.123456+00:00', id: 42 });
  assertEquals(parseGetMode(q(`before=${encodeURIComponent(raw)}`)), {
    kind: 'history',
    before: { ts: '2026-07-04T10:00:00.123456+00:00', id: 42 },
  });
});

Deno.test('hub-posts modes: a cursor cannot smuggle PostgREST syntax', () => {
  for (const bad of [
    '2026-07-04T10:00:00Z,status.neq.postado|1',
    '2026-07-04T10:00:00Z)|1',
    'not-a-date|1',
    '2026-07-04T10:00:00Z|abc',
    '2026-07-04T10:00:00Z',
    '|1',
  ]) {
    assertEquals(parseCursor(bad), null, bad);
  }
});

Deno.test('hub-posts modes: range bounds', () => {
  assertEquals(parseGetMode(q('from=2026-03-01T03:00:00.000Z&to=2026-04-01T03:00:00.000Z')), {
    kind: 'range',
    from: '2026-03-01T03:00:00.000Z',
    to: '2026-04-01T03:00:00.000Z',
  });
  assertEquals(parseGetMode(q('from=2026-04-01T00:00:00.000Z&to=2026-04-01T00:00:00.000Z')), null);
  assertEquals(parseGetMode(q('from=2026-04-02T00:00:00.000Z&to=2026-04-01T00:00:00.000Z')), null);
  assertEquals(parseGetMode(q('from=2026-01-01T00:00:00.000Z&to=2026-02-16T00:00:00.000Z')), null);
  assertEquals(parseGetMode(q('from=2026-01-01T00:00:00.000Z')), null);
  assertEquals(parseGetMode(q('from=x&to=y')), null);
});

Deno.test('hub-posts modes: post id and conflicts', () => {
  assertEquals(parseGetMode(q('post_id=5061')), { kind: 'post', postId: 5061 });
  assertEquals(parseGetMode(q('post_id=5a')), null);
  assertEquals(parseGetMode(q('post_id=1&before=2026-07-04T00:00:00.000Z|0')), null);
  assertEquals(
    parseGetMode(q('post_id=1&from=2026-03-01T00:00:00.000Z&to=2026-04-01T00:00:00.000Z')),
    null,
  );
});
