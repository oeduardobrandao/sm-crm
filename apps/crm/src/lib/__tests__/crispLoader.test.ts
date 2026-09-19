import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedConsent } from '../../test/consent';

describe('crispLoader', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    document.head.querySelectorAll('script').forEach((s) => s.remove());
    delete (window as { $crisp?: unknown }).$crisp;
  });
  afterEach(() => vi.useRealTimers());

  it('injects the Crisp script exactly once', async () => {
    const { loadCrisp, CRISP_SCRIPT_SRC } = await import('../crispLoader');
    loadCrisp();
    loadCrisp();
    expect(document.head.querySelectorAll(`script[src="${CRISP_SCRIPT_SRC}"]`)).toHaveLength(1);
  });

  it('keeps an existing $crisp queue so earlier pushes are consumed by the widget', async () => {
    const queue: unknown[][] = [['set', 'user:nickname', ['Ana']]];
    window.$crisp = queue;
    const { loadCrisp } = await import('../crispLoader');
    loadCrisp();
    expect(window.$crisp).toBe(queue);
  });

  it('creates the queue when it is missing', async () => {
    const { loadCrisp } = await import('../crispLoader');
    loadCrisp();
    expect(Array.isArray(window.$crisp)).toBe(true);
  });

  it('loadCrispWhenIdle defers the load (setTimeout fallback in jsdom)', async () => {
    vi.useFakeTimers();
    seedConsent({ support: true });
    const { loadCrispWhenIdle, CRISP_SCRIPT_SRC } = await import('../crispLoader');
    loadCrispWhenIdle();
    expect(document.head.querySelector(`script[src="${CRISP_SCRIPT_SRC}"]`)).toBeNull();
    vi.advanceTimersByTime(2500);
    expect(document.head.querySelector(`script[src="${CRISP_SCRIPT_SRC}"]`)).not.toBeNull();
  });

  it('loadCrispWhenIdle does not inject the script if consent was revoked before it fires', async () => {
    vi.useFakeTimers();
    seedConsent({ support: true });
    const { loadCrispWhenIdle, CRISP_SCRIPT_SRC } = await import('../crispLoader');
    loadCrispWhenIdle();
    seedConsent({ support: false });
    vi.advanceTimersByTime(5000);
    expect(document.head.querySelector(`script[src="${CRISP_SCRIPT_SRC}"]`)).toBeNull();
  });
});
