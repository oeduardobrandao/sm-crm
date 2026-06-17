import { describe, it, expect, beforeEach, vi } from 'vitest';
import worker from './index';

// --- Test signing key (must match what we sign requests with) ---
const SIGNING_KEY = 'test-signing-key';
const KEY = 'contas/1/posts/2/video.mp4';
const ORIGIN = 'https://hub.mesaas.com.br';

// Replicate the worker's HMAC signing so we can mint valid signed URLs.
async function hmacSign(key: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function signedUrl(key: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const sig = await hmacSign(SIGNING_KEY, `${key}:${exp}`);
  return `https://media.example/${encodeURIComponent(key)}?exp=${exp}&sig=${sig}`;
}

function streamFromBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

// Parse a Range header the way R2 does, returning the resolved slice.
function parseRange(headers: Headers, size: number): { offset: number; length: number } | undefined {
  const h = headers.get('Range');
  if (!h) return undefined;
  const m = /^bytes=(\d*)-(\d*)$/.exec(h.trim());
  if (!m) return undefined;
  const [, s, e] = m;
  if (s === '' && e === '') return undefined;
  if (s === '') {
    const suffix = Math.min(Number(e), size);
    return { offset: size - suffix, length: suffix };
  }
  const offset = Number(s);
  const end = e === '' ? size - 1 : Math.min(Number(e), size - 1);
  return { offset, length: end - offset + 1 };
}

// Minimal in-memory R2 bucket holding one object.
function makeBucket(fullBytes: Uint8Array, contentType: string) {
  const baseObject = (servedBytes: Uint8Array, range?: { offset: number; length: number }) => ({
    size: fullBytes.length, // R2: size is always the TOTAL object size
    httpEtag: '"etag-abc"',
    httpMetadata: { contentType },
    range,
    body: streamFromBytes(servedBytes),
    writeHttpMetadata: () => {},
    async arrayBuffer() {
      return servedBytes.buffer.slice(servedBytes.byteOffset, servedBytes.byteOffset + servedBytes.byteLength);
    },
  });
  return {
    get: vi.fn(async (_key: string, options?: { range?: Headers }) => {
      const range = options?.range instanceof Headers ? parseRange(options.range, fullBytes.length) : undefined;
      if (range) {
        const slice = fullBytes.subarray(range.offset, range.offset + range.length);
        return baseObject(slice, range);
      }
      return baseObject(fullBytes);
    }),
    head: vi.fn(async () => baseObject(fullBytes)),
  };
}

// Minimal Cache API stub.
function makeCache() {
  const store = new Map<string, Response>();
  return {
    putCount: 0,
    match: vi.fn(async function (this: any, req: Request) {
      return store.get(req.url) ?? undefined;
    }),
    put: vi.fn(async function (this: any, req: Request, res: Response) {
      this.putCount++;
      store.set(req.url, res);
    }),
  };
}

let cache: ReturnType<typeof makeCache>;

beforeEach(() => {
  cache = makeCache();
  (globalThis as any).caches = { default: cache };
});

const ctx = { waitUntil: (_p: Promise<unknown>) => {}, passThroughOnException: () => {} } as any;

function env(bucket: ReturnType<typeof makeBucket>) {
  return { MEDIA_BUCKET: bucket, MEDIA_SIGNING_KEY: SIGNING_KEY, ALLOWED_ORIGINS: ORIGIN } as any;
}

describe('media-proxy range support', () => {
  it('returns 206 Partial Content for an explicit byte range', async () => {
    const bytes = new Uint8Array(1000).map((_, i) => i % 256);
    const req = new Request(await signedUrl(KEY), { headers: { Range: 'bytes=0-99', Origin: ORIGIN } });

    const res = await worker.fetch(req, env(makeBucket(bytes, 'video/mp4')), ctx);

    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe('bytes 0-99/1000');
    expect(res.headers.get('Content-Length')).toBe('100');
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body.length).toBe(100);
  });

  it('returns 206 for an open-ended range (the request browsers send first)', async () => {
    const bytes = new Uint8Array(1000).fill(7);
    const req = new Request(await signedUrl(KEY), { headers: { Range: 'bytes=0-', Origin: ORIGIN } });

    const res = await worker.fetch(req, env(makeBucket(bytes, 'video/mp4')), ctx);

    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe('bytes 0-999/1000');
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
  });

  it('never caches range responses (prevents truncated-cache poisoning)', async () => {
    const bytes = new Uint8Array(1000).fill(1);
    const req = new Request(await signedUrl(KEY), { headers: { Range: 'bytes=0-', Origin: ORIGIN } });

    await worker.fetch(req, env(makeBucket(bytes, 'video/mp4')), ctx);

    expect(cache.putCount).toBe(0);
  });

  it('serves a full 200 with Accept-Ranges for a non-range request and caches it', async () => {
    const bytes = new Uint8Array(500).fill(9);
    const req = new Request(await signedUrl('contas/1/posts/2/thumb.jpg'), { headers: { Origin: ORIGIN } });

    const res = await worker.fetch(req, env(makeBucket(bytes, 'image/jpeg')), ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
    expect(res.headers.get('Content-Length')).toBe('500');
    expect(cache.putCount).toBe(1);
  });

  it('advertises Accept-Ranges on a HEAD request without a body', async () => {
    const bytes = new Uint8Array(1000).fill(3);
    const req = new Request(await signedUrl(KEY), { method: 'HEAD', headers: { Origin: ORIGIN } });

    const res = await worker.fetch(req, env(makeBucket(bytes, 'video/mp4')), ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
    expect(res.headers.get('Content-Length')).toBe('1000');
    expect(await res.text()).toBe('');
  });
});
