import { afterEach, describe, expect, it, vi } from 'vitest';

// ALL_CATEGORIES is computed once at module load (the app's bridge is injected
// before any page script), so each case loads a fresh copy of the module.
async function loadConfig() {
  vi.resetModules();
  return import('../categoryConfig');
}

afterEach(() => {
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
});

describe('help categories', () => {
  it('lists "Cobrança & Plano" on the web', async () => {
    const { ALL_CATEGORIES } = await loadConfig();
    expect(ALL_CATEGORIES).toContain('cobranca');
  });

  it('filters "Cobrança & Plano" out inside the native app, keeping its label', async () => {
    (window as unknown as { Capacitor?: unknown }).Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'ios',
    };
    const { ALL_CATEGORIES, CATEGORY_LABELS } = await loadConfig();
    expect(ALL_CATEGORIES).not.toContain('cobranca');
    expect(ALL_CATEGORIES).toContain('financeiro');
    // An article already filed under it still resolves a label.
    expect(CATEGORY_LABELS.cobranca).toBe('Cobrança & Plano');
  });
});
