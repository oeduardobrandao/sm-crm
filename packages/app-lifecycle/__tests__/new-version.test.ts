import { describe, it, expect, afterEach, vi } from 'vitest';
import { extractBuildFingerprint, watchForNewVersion } from '../src/new-version';

const HTML = (hash: string) =>
  `<!DOCTYPE html><html><head>
     <link rel="stylesheet" href="/assets/index-${hash}.css" />
   </head><body>
     <script type="module" src="/assets/index-${hash}.js"></script>
   </body></html>`;

const stops: Array<() => void> = [];

function watch(onNewVersion: () => void) {
  const stop = watchForNewVersion({ documentUrl: '/app.html', intervalMs: 5, onNewVersion });
  stops.push(stop);
  return stop;
}

afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  vi.restoreAllMocks();
});

describe('extractBuildFingerprint', () => {
  it('collects hashed asset references, order-independently', () => {
    const a = '<script src="/assets/a-111.js"></script><link href="/assets/b-222.css" />';
    const b = '<link href="/assets/b-222.css" /><script src="/assets/a-111.js"></script>';
    expect(extractBuildFingerprint(a)).toBe(extractBuildFingerprint(b));
  });

  it('changes when a hash changes', () => {
    expect(extractBuildFingerprint(HTML('aaa'))).not.toBe(extractBuildFingerprint(HTML('bbb')));
  });

  it('returns null for a document with no hashed assets', () => {
    expect(extractBuildFingerprint('<html><body>Login</body></html>')).toBeNull();
  });
});

describe('watchForNewVersion', () => {
  function mockFetch(responses: Array<string | Error>) {
    let call = 0;
    return vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      const next = responses[Math.min(call++, responses.length - 1)];
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve(new Response(next, { status: 200 }));
    });
  }

  it('treats the first poll as the baseline and does not fire', async () => {
    const fetchSpy = mockFetch([HTML('aaa')]);
    const onNewVersion = vi.fn();

    watch(onNewVersion);

    await vi.waitFor(() => expect(fetchSpy.mock.calls.length).toBeGreaterThan(2));
    expect(onNewVersion).not.toHaveBeenCalled();
  });

  it('fires once when the deployed assets change', async () => {
    mockFetch([HTML('aaa'), HTML('bbb')]);
    const onNewVersion = vi.fn();

    watch(onNewVersion);

    await vi.waitFor(() => expect(onNewVersion).toHaveBeenCalledTimes(1));
    // It stops polling after firing, so the count stays at one.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(onNewVersion).toHaveBeenCalledTimes(1);
  });

  it('ignores a response with no hashed assets', async () => {
    const fetchSpy = mockFetch([HTML('aaa'), '<html><body>Sessão expirada</body></html>']);
    const onNewVersion = vi.fn();

    watch(onNewVersion);

    await vi.waitFor(() => expect(fetchSpy.mock.calls.length).toBeGreaterThan(3));
    expect(onNewVersion).not.toHaveBeenCalled();
  });

  it('survives a failed fetch and keeps polling', async () => {
    const fetchSpy = mockFetch([new Error('offline'), HTML('aaa'), HTML('bbb')]);
    const onNewVersion = vi.fn();

    watch(onNewVersion);

    await vi.waitFor(() => expect(onNewVersion).toHaveBeenCalledTimes(1));
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(1);
  });

  it('stops polling when stopped', async () => {
    const fetchSpy = mockFetch([HTML('aaa')]);

    const stop = watch(vi.fn());
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    stop();

    const callsAtStop = fetchSpy.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fetchSpy.mock.calls.length).toBe(callsAtStop);
  });
});
