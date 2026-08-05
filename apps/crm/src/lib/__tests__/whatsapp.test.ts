import { beforeEach, describe, expect, it, vi } from 'vitest';

const NUMBER = '5511999999999';

/**
 * The module reads import.meta.env at module scope, so every case has to reset
 * the registry and re-import to pick up a new stubbed value.
 */
async function load(number: string | undefined) {
  vi.resetModules();
  vi.stubEnv('VITE_WHATSAPP_SUPPORT_NUMBER', number ?? '');
  return await import('../whatsapp');
}

/** The decoded `text` query param, which is what we actually care about. */
function textOf(url: string): string {
  return decodeURIComponent(new URL(url).searchParams.get('text') ?? '');
}

describe('buildWhatsAppSupportUrl', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds an onboarding link with name and company', async () => {
    const { buildWhatsAppSupportUrl } = await load(NUMBER);
    const url = buildWhatsAppSupportUrl({
      nome: 'Ana Souza',
      empresa: 'Acme',
      context: 'onboarding',
    });
    expect(url).not.toBeNull();
    expect(url!.startsWith(`https://wa.me/${NUMBER}?text=`)).toBe(true);
    expect(textOf(url!)).toBe(
      'Oi! Sou Ana, da Acme. Acabei de criar minha conta no Mesaas e queria ajuda pra configurar.',
    );
  });

  it('uses the dashboard wording for the dashboard context', async () => {
    const { buildWhatsAppSupportUrl } = await load(NUMBER);
    const url = buildWhatsAppSupportUrl({
      nome: 'Ana',
      empresa: 'Acme',
      context: 'dashboard',
    });
    expect(textOf(url!)).toBe('Oi! Sou Ana, da Acme. Queria falar com vocês sobre o Mesaas.');
  });

  it('reduces the name to its first word', async () => {
    const { buildWhatsAppSupportUrl } = await load(NUMBER);
    const url = buildWhatsAppSupportUrl({
      nome: '  Ana Paula   Souza ',
      empresa: 'Acme',
      context: 'onboarding',
    });
    expect(textOf(url!)).toContain('Sou Ana, da Acme.');
  });

  it('never puts an article before the name', async () => {
    // "Sou o Ana" agrees wrong and any fixed article misgenders half the users.
    const { buildWhatsAppSupportUrl } = await load(NUMBER);
    const url = buildWhatsAppSupportUrl({ nome: 'Ana', empresa: null, context: 'onboarding' });
    expect(textOf(url!)).toContain('Sou Ana.');
    expect(textOf(url!)).not.toMatch(/Sou\s+(o|a|o\/a)\s/);
  });

  it.each([
    [{ nome: 'Ana', empresa: null }, 'Oi! Sou Ana. Acabei'],
    [{ nome: null, empresa: 'Acme' }, 'Oi! Sou da Acme. Acabei'],
    [{ nome: null, empresa: null }, 'Oi! Acabei'],
    [{ nome: '   ', empresa: '  ' }, 'Oi! Acabei'],
    [{ nome: undefined, empresa: undefined }, 'Oi! Acabei'],
  ])('degrades cleanly for %j', async (fields, expectedStart) => {
    const { buildWhatsAppSupportUrl } = await load(NUMBER);
    const url = buildWhatsAppSupportUrl({ ...fields, context: 'onboarding' });
    expect(textOf(url!).startsWith(expectedStart)).toBe(true);
    expect(textOf(url!)).not.toContain('undefined');
    expect(textOf(url!)).not.toContain('null');
  });

  it('percent-encodes accents and spaces', async () => {
    const { buildWhatsAppSupportUrl } = await load(NUMBER);
    const url = buildWhatsAppSupportUrl({
      nome: 'João',
      empresa: 'Açaí & Cia',
      context: 'dashboard',
    });
    expect(url).toContain('%20');
    expect(url).not.toContain(' ');
    expect(textOf(url!)).toContain('Sou João, da Açaí & Cia.');
  });

  it.each(['', '   ', '+5511999999999', '55 11 99999-9999', '(11) 99999-9999', 'abc'])(
    'returns null for the malformed value %o',
    async (bad) => {
      // Fails closed on malformed, not only on missing: a number pasted from a
      // phone would otherwise ship a dead link to production.
      const { buildWhatsAppSupportUrl, isWhatsAppSupportEnabled } = await load(bad);
      expect(buildWhatsAppSupportUrl({ nome: 'Ana', context: 'onboarding' })).toBeNull();
      expect(isWhatsAppSupportEnabled()).toBe(false);
    },
  );

  it('reports enabled only for a digits-only value', async () => {
    const { isWhatsAppSupportEnabled } = await load(NUMBER);
    expect(isWhatsAppSupportEnabled()).toBe(true);
  });
});
