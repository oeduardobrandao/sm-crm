import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPagarme12xEnabled } from '../pagarme-gate';

describe('isPagarme12xEnabled', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is false when the plan flag is off and the env key is unset', () => {
    vi.stubEnv('VITE_PAGARME_PUBLIC_KEY', '');
    expect(isPagarme12xEnabled({ pagarme_12x_enabled: false })).toBe(false);
  });

  it('is false when the plan flag is off and the env key is set', () => {
    vi.stubEnv('VITE_PAGARME_PUBLIC_KEY', 'pk_test_abc');
    expect(isPagarme12xEnabled({ pagarme_12x_enabled: false })).toBe(false);
  });

  it('is false when the plan flag is on and the env key is unset', () => {
    vi.stubEnv('VITE_PAGARME_PUBLIC_KEY', '');
    expect(isPagarme12xEnabled({ pagarme_12x_enabled: true })).toBe(false);
  });

  it('is true only when the plan flag is on and the env key is set', () => {
    vi.stubEnv('VITE_PAGARME_PUBLIC_KEY', 'pk_test_abc');
    expect(isPagarme12xEnabled({ pagarme_12x_enabled: true })).toBe(true);
  });

  it('treats a null/undefined plan as flag-off', () => {
    vi.stubEnv('VITE_PAGARME_PUBLIC_KEY', 'pk_test_abc');
    expect(isPagarme12xEnabled(null)).toBe(false);
    expect(isPagarme12xEnabled(undefined)).toBe(false);
  });
});
