import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWithRetry } from '../fetchWithRetry';

const ok200 = () => new Response('ok', { status: 200 });
const err500 = () => new Response('fail', { status: 500 });
const err403 = () => new Response('forbidden', { status: 403 });
const err404 = () => new Response('not found', { status: 404 });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('fetchWithRetry', () => {
  it('returns response on first success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok200()));
    const res = await fetchWithRetry('https://example.com/a');
    expect(res.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries on network error then succeeds', async () => {
    const mock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(ok200());
    vi.stubGlobal('fetch', mock);

    const promise = fetchWithRetry('https://example.com/a');
    await vi.advanceTimersByTimeAsync(500);
    const res = await promise;

    expect(res.ok).toBe(true);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('retries on 500 then succeeds', async () => {
    const mock = vi.fn().mockResolvedValueOnce(err500()).mockResolvedValueOnce(ok200());
    vi.stubGlobal('fetch', mock);

    const promise = fetchWithRetry('https://example.com/a');
    await vi.advanceTimersByTimeAsync(500);
    const res = await promise;

    expect(res.ok).toBe(true);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('does not retry on 403', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(err403()));
    await expect(fetchWithRetry('https://example.com/a')).rejects.toThrow('HTTP 403');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry on 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(err404()));
    await expect(fetchWithRetry('https://example.com/a')).rejects.toThrow('HTTP 404');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry AbortError', async () => {
    const abort = new DOMException('The operation was aborted', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abort));
    await expect(fetchWithRetry('https://example.com/a')).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry unsafe methods (POST)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(fetchWithRetry('https://example.com/a', { method: 'POST' })).rejects.toThrow(
      'Failed to fetch',
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('exhausts all attempts then throws last error', async () => {
    vi.useRealTimers();
    const mock = vi.fn().mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    vi.stubGlobal('fetch', mock);

    await expect(
      fetchWithRetry('https://example.com/a', undefined, { maxAttempts: 3, baseDelayMs: 1 }),
    ).rejects.toThrow('Failed to fetch');
    expect(mock).toHaveBeenCalledTimes(3);
  });

  it('applies exponential backoff delays', async () => {
    const mock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fail'))
      .mockRejectedValueOnce(new TypeError('fail'))
      .mockResolvedValueOnce(ok200());
    vi.stubGlobal('fetch', mock);

    const promise = fetchWithRetry('https://example.com/a', undefined, {
      maxAttempts: 3,
      baseDelayMs: 500,
    });

    expect(mock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(499);
    expect(mock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(mock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(999);
    expect(mock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);

    const res = await promise;
    expect(res.ok).toBe(true);
    expect(mock).toHaveBeenCalledTimes(3);
  });
});
