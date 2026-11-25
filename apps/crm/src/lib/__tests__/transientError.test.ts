import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isTransientDbError, retryTransient } from '../transientError';

describe('isTransientDbError', () => {
  it('treats gateway timeouts and network failures as transient', () => {
    // 504 text/plain from the gateway: postgrest-js returns { message: body }
    expect(isTransientDbError({ message: 'upstream request timeout' })).toBe(true);
    // fetch rejected inside postgrest-js
    expect(
      isTransientDbError({
        message: 'TypeError: Failed to fetch',
        details: '',
        hint: '',
        code: '',
      }),
    ).toBe(true);
    expect(isTransientDbError(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('treats statement timeout, serialization failure and deadlock as transient', () => {
    for (const code of ['57014', '40001', '40P01']) {
      expect(isTransientDbError({ message: 'x', code })).toBe(true);
    }
  });

  it('does not retry permission, constraint or PostgREST errors', () => {
    for (const code of ['42501', '23505', 'P0001', 'PGRST116']) {
      expect(isTransientDbError({ message: 'x', code })).toBe(false);
    }
  });

  it('does not treat app errors or junk as transient', () => {
    expect(isTransientDbError(new Error('boom'))).toBe(false);
    expect(isTransientDbError(null)).toBe(false);
    expect(isTransientDbError('504')).toBe(false);
    expect(isTransientDbError({})).toBe(false);
  });
});

describe('retryTransient', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('retries a transient failure and returns the later success', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ message: 'upstream request timeout' })
      .mockResolvedValueOnce('ok');
    const p = retryTransient(fn, [10, 20]);
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('gives up after the last delay and rethrows the transient error', async () => {
    const err = { message: 'TypeError: Failed to fetch', code: '' };
    const fn = vi.fn().mockRejectedValue(err);
    const p = retryTransient(fn, [10, 20]);
    const assertion = expect(p).rejects.toBe(err);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('rethrows a non-transient error without retrying', async () => {
    const err = { message: 'permission denied', code: '42501' };
    const fn = vi.fn().mockRejectedValue(err);
    await expect(retryTransient(fn, [10, 20])).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
