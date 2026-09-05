import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prefetchBuildAssets } from '../src/prefetch-build';

type Manifest = Record<string, { file: string; css?: string[]; isEntry?: boolean }>;

const MANIFEST: Manifest = {
  'index.html': { file: 'assets/index-abc.js', css: ['assets/index-abc.css'], isEntry: true },
  'src/pages/EntregasPage.tsx': {
    file: 'assets/EntregasPage-def.js',
    css: ['assets/EntregasPage-def.css'],
  },
  'src/pages/ClientesPage.tsx': { file: 'assets/ClientesPage-ghi.js' },
};

function setDocument(base: '/' | '/admin/', entryHash = 'abc') {
  document.head.innerHTML = `<link rel="stylesheet" href="${base}assets/index-${entryHash}.css" />`;
  document.body.innerHTML = `<script type="module" src="${base}assets/index-${entryHash}.js"></script>`;
}

/** fetchFn that records URLs and resolves immediately, unless `pending` holds a URL back. */
function makeFetch(manifest: Manifest = MANIFEST, failing: string[] = []) {
  const calls: string[] = [];
  const fetchFn = vi.fn(async (input: string) => {
    calls.push(input);
    if (input.endsWith('build-manifest.json')) return new Response(JSON.stringify(manifest));
    if (failing.includes(input)) throw new Error('404');
    return new Response('');
  });
  return { fetchFn, calls };
}

function setConnection(value: { saveData?: boolean; effectiveType?: string } | undefined) {
  Object.defineProperty(navigator, 'connection', { configurable: true, value });
}

const cancels: Array<() => void> = [];

function run(options: Parameters<typeof prefetchBuildAssets>[0]) {
  const cancel = prefetchBuildAssets(options);
  cancels.push(cancel);
  return cancel;
}

beforeEach(() => {
  vi.useFakeTimers();
  setDocument('/');
});

afterEach(() => {
  cancels.splice(0).forEach((cancel) => cancel());
  vi.useRealTimers();
  delete (navigator as unknown as { connection?: unknown }).connection;
});

describe('prefetchBuildAssets', () => {
  it('resolves manifest files against the manifest URL and skips what the document already loads', async () => {
    const { fetchFn, calls } = makeFetch();
    run({ manifestUrl: '/build-manifest.json', fetchFn });
    await vi.advanceTimersByTimeAsync(2_000);

    expect(calls).toEqual([
      '/build-manifest.json',
      '/assets/EntregasPage-def.js',
      '/assets/EntregasPage-def.css',
      '/assets/ClientesPage-ghi.js',
    ]);
    expect((fetchFn.mock.calls[1] as unknown[])[1]).toMatchObject({ priority: 'low' });
  });

  it('honours a base path such as /admin/', async () => {
    setDocument('/admin/');
    const { fetchFn, calls } = makeFetch();
    run({ manifestUrl: '/admin/build-manifest.json', fetchFn });
    await vi.advanceTimersByTimeAsync(2_000);

    expect(calls).toEqual([
      '/admin/build-manifest.json',
      '/admin/assets/EntregasPage-def.js',
      '/admin/assets/EntregasPage-def.css',
      '/admin/assets/ClientesPage-ghi.js',
    ]);
  });

  it('aborts when the manifest entry is not the script the document loaded', async () => {
    setDocument('/', 'zzz');
    const { fetchFn, calls } = makeFetch();
    run({ manifestUrl: '/build-manifest.json', fetchFn });
    await vi.advanceTimersByTimeAsync(2_000);

    expect(calls).toEqual(['/build-manifest.json']);
  });

  it('does nothing on a data-saver or slow connection', async () => {
    setConnection({ saveData: true });
    const saver = makeFetch();
    run({ manifestUrl: '/build-manifest.json', fetchFn: saver.fetchFn });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(saver.calls).toEqual([]);

    setConnection({ effectiveType: '2g' });
    const slow = makeFetch();
    run({ manifestUrl: '/build-manifest.json', fetchFn: slow.fetchFn });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(slow.calls).toEqual([]);
  });

  it('keeps at most `concurrency` requests in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    const resolvers: Array<() => void> = [];
    const fetchFn = vi.fn(async (input: string) => {
      if (input.endsWith('build-manifest.json')) return new Response(JSON.stringify(MANIFEST));
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((resolve) => resolvers.push(resolve));
      inFlight -= 1;
      return new Response('');
    });
    run({ manifestUrl: '/build-manifest.json', fetchFn, concurrency: 2 });
    await vi.advanceTimersByTimeAsync(2_000);

    expect(peak).toBe(2);
    resolvers.splice(0).forEach((resolve) => resolve());
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it('keeps going when one file fails', async () => {
    const { fetchFn, calls } = makeFetch(MANIFEST, ['/assets/EntregasPage-def.js']);
    run({ manifestUrl: '/build-manifest.json', fetchFn });
    await vi.advanceTimersByTimeAsync(2_000);

    expect(calls).toContain('/assets/ClientesPage-ghi.js');
  });

  it('gives up silently when the manifest cannot be read', async () => {
    const fetchFn = vi.fn(async () => new Response('not json', { status: 500 }));
    run({ manifestUrl: '/build-manifest.json', fetchFn });
    await vi.advanceTimersByTimeAsync(2_000);

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('does nothing once cancelled', async () => {
    const { fetchFn } = makeFetch();
    const cancel = run({ manifestUrl: '/build-manifest.json', fetchFn });
    cancel();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(fetchFn).not.toHaveBeenCalled();
  });
});
