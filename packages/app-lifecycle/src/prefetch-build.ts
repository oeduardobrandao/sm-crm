/**
 * Warm the HTTP cache with every chunk of the running build.
 *
 * Assets under `/assets/` are content-hashed and served `immutable`, so once a chunk is in
 * the cache a tab keeps finding it there after the next deploy stops serving that build.
 * The list comes from Vite's manifest (`build.manifest: 'build-manifest.json'`), whose
 * `file` paths are relative to the build's outDir and carry no `base`: they are resolved
 * against the manifest URL, which yields `/assets/...` for the CRM and `/admin/assets/...`
 * for the Admin.
 *
 * Runs on idle, only on a decent connection, and only when the manifest describes the build
 * this document loaded (a deploy can land between the two requests).
 */

const DEFAULT_CONCURRENCY = 3;
const IDLE_FALLBACK_MS = 2_000;

interface ManifestChunk {
  file: string;
  css?: string[];
  isEntry?: boolean;
}

type Manifest = Record<string, ManifestChunk>;

interface NetworkInformationLike {
  saveData?: boolean;
  effectiveType?: string;
}

export interface PrefetchBuildOptions {
  /** '/build-manifest.json' for the CRM, '/admin/build-manifest.json' for the Admin. */
  manifestUrl: string;
  concurrency?: number;
  /** Test seam. Defaults to `fetch`. */
  fetchFn?: (input: string, init?: RequestInit) => Promise<Response>;
}

function isConstrainedConnection(): boolean {
  const connection = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
  if (!connection) return false;
  return connection.saveData === true || /^(slow-)?[23]g$/.test(connection.effectiveType ?? '');
}

function documentEntryPath(doc: Document): string | null {
  const script = doc.querySelector<HTMLScriptElement>('script[type="module"][src]');
  return script ? new URL(script.getAttribute('src')!, doc.baseURI).pathname : null;
}

function referencedPaths(doc: Document): Set<string> {
  const paths = new Set<string>();
  for (const el of doc.querySelectorAll('script[src], link[href]')) {
    const raw = el.getAttribute('src') ?? el.getAttribute('href');
    if (raw) paths.add(new URL(raw, doc.baseURI).pathname);
  }
  return paths;
}

function scheduleOnIdle(callback: () => void): void {
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(() => callback(), { timeout: 5_000 });
  } else {
    setTimeout(callback, IDLE_FALLBACK_MS);
  }
}

/** Start the prefetch on idle. Returns a cancel function. */
export function prefetchBuildAssets(options: PrefetchBuildOptions): () => void {
  const { manifestUrl, concurrency = DEFAULT_CONCURRENCY } = options;
  const fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init));
  const controller = new AbortController();
  const { signal } = controller;

  async function run(): Promise<void> {
    if (signal.aborted || isConstrainedConnection()) return;

    let manifest: Manifest;
    try {
      const response = await fetchFn(manifestUrl, { cache: 'no-store', signal });
      if (!response.ok) return;
      manifest = (await response.json()) as Manifest;
    } catch {
      return;
    }
    if (signal.aborted) return;

    const manifestBase = new URL(manifestUrl, window.location.origin);
    const toPath = (file: string) => new URL(file, manifestBase).pathname;
    const chunks = Object.values(manifest);
    const entry = chunks.find((chunk) => chunk.isEntry);
    if (!entry || documentEntryPath(document) !== toPath(entry.file)) return;

    const loaded = referencedPaths(document);
    const queue: string[] = [];
    const seen = new Set<string>();
    for (const chunk of chunks) {
      for (const file of [chunk.file, ...(chunk.css ?? [])]) {
        const path = toPath(file);
        if (seen.has(path) || loaded.has(path)) continue;
        seen.add(path);
        queue.push(path);
      }
    }

    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length > 0 && !signal.aborted) {
        const path = queue.shift()!;
        try {
          const response = await fetchFn(path, { signal, priority: 'low' });
          // Resolving on headers is not enough: the cache entry is only complete once the
          // body has been read to the end.
          await response.arrayBuffer();
        } catch {
          // One miss does not stop the queue.
        }
      }
    });
    await Promise.all(workers);
  }

  scheduleOnIdle(() => {
    void run();
  });

  return () => controller.abort();
}
