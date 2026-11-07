import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  containsBlockedLink,
  isBlockedInNativeApp,
  openSitePageInNativeApp,
  publicSiteUrl,
} from '../blockedPaths';

type CapacitorStub = {
  isNativePlatform?: () => boolean;
  isPluginAvailable?: (name: string) => boolean;
  Plugins?: Record<string, unknown>;
};

function setCapacitor(stub: CapacitorStub | undefined) {
  (window as unknown as { Capacitor?: CapacitorStub }).Capacitor = stub;
}

afterEach(() => setCapacitor(undefined));

describe('isBlockedInNativeApp', () => {
  it.each([
    '/',
    '/precos',
    '/comecar?plan=pro',
    '/configuracao/cobranca',
    '/blog/x',
    '/blog',
    '/novidades',
    '/afiliados/painel',
    '/sobre',
    '/aprovacao-de-post',
    '/portal-do-cliente',
    '/agente-de-conteudo-ia',
    '/Precos',
    '/precos/',
    '/precos#anual',
    'https://www.mesaas.com.br/precos',
    'https://mesaas.com.br/comecar?plan=max',
    'https://www.mesaas.com.br/',
    '//www.mesaas.com.br/precos',
  ])('blocks %s', (path) => {
    expect(isBlockedInNativeApp(path)).toBe(true);
  });

  it.each([
    '/dashboard',
    '/configuracao/notificacoes',
    '/politica-de-privacidade',
    '/termos-de-uso',
    '/lgpd',
    '/precosx',
    '/blogger',
    '/login',
    'https://example.com/precos',
    'https://www.mesaas.com.br/politica-de-privacidade',
    'mailto:oi@mesaas.com.br',
    '',
    'not a url at all',
  ])('allows %s', (path) => {
    expect(isBlockedInNativeApp(path)).toBe(false);
  });
});

describe('containsBlockedLink', () => {
  it('finds a markdown link to a blocked path', () => {
    expect(
      containsBlockedLink('Novo plano! [Veja os preços](https://www.mesaas.com.br/precos)'),
    ).toBe(true);
    expect(containsBlockedLink('[Assine](/comecar?plan=pro) hoje')).toBe(true);
  });

  it('finds an html anchor and a bare url', () => {
    expect(containsBlockedLink('<a href="/configuracao/cobranca">pagar</a>')).toBe(true);
    expect(containsBlockedLink('Acesse https://mesaas.com.br/precos agora')).toBe(true);
    expect(containsBlockedLink('Acesse www.mesaas.com.br/precos agora')).toBe(true);
  });

  it('ignores text without blocked links', () => {
    expect(containsBlockedLink('Manutenção hoje às 22h')).toBe(false);
    expect(containsBlockedLink('[Ajuda](/ajuda/x) e https://example.com/precos')).toBe(false);
    expect(containsBlockedLink(null)).toBe(false);
    expect(containsBlockedLink(undefined)).toBe(false);
  });
});

describe('publicSiteUrl', () => {
  it('builds the absolute site URL for a path', () => {
    expect(publicSiteUrl('/politica-de-privacidade')).toBe(
      'https://www.mesaas.com.br/politica-de-privacidade',
    );
  });
});

describe('openSitePageInNativeApp', () => {
  it('does nothing on the web', () => {
    expect(openSitePageInNativeApp('/politica-de-privacidade')).toBe(false);
  });

  it('opens a legal page outside the web view inside the app', () => {
    const openUrl = vi.fn().mockResolvedValue(undefined);
    setCapacitor({
      isNativePlatform: () => true,
      isPluginAvailable: (name) => name === 'MesaasNative',
      Plugins: { MesaasNative: { openUrl } },
    });
    expect(openSitePageInNativeApp('/termos-de-uso')).toBe(true);
    expect(openUrl).toHaveBeenCalledWith({ url: 'https://www.mesaas.com.br/termos-de-uso' });
  });

  it('leaves app routes alone', () => {
    const openUrl = vi.fn();
    setCapacitor({
      isNativePlatform: () => true,
      isPluginAvailable: () => true,
      Plugins: { MesaasNative: { openUrl } },
    });
    expect(openSitePageInNativeApp('/configuracao')).toBe(false);
    expect(openUrl).not.toHaveBeenCalled();
  });

  it('reports false on an older binary without the plugin', () => {
    setCapacitor({ isNativePlatform: () => true, isPluginAvailable: () => false });
    expect(openSitePageInNativeApp('/lgpd')).toBe(false);
  });

  it('never rejects when openUrl rejects', async () => {
    const openUrl = vi.fn().mockRejectedValue(new Error('nope'));
    setCapacitor({
      isNativePlatform: () => true,
      isPluginAvailable: () => true,
      Plugins: { MesaasNative: { openUrl } },
    });
    expect(openSitePageInNativeApp('/lgpd')).toBe(true);
    await Promise.resolve();
  });
});
