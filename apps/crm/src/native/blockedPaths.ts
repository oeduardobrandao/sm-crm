import { isNativeApp } from './platform';
import { getMesaasNative } from './mesaasNative';

// Which CRM paths the iOS app never shows (apps/mobile/DECISIONS.md D5, D33): sign-up,
// pricing, billing and the marketing site. Nothing here reads `window` at module scope;
// the entry imports this through useNativePathGuard and the SSR prerender runs it in Node.

/** The public site. Legal pages open here, outside the web view, inside the app. */
const SITE_ORIGIN = 'https://www.mesaas.com.br';
const SITE_HOSTS = new Set(['www.mesaas.com.br', 'mesaas.com.br']);

/** `/` matches only itself; every other entry also matches its sub-paths. */
const BLOCKED_PREFIXES = [
  '/precos',
  '/comecar',
  '/configuracao/cobranca',
  '/sobre',
  '/aprovacao-de-post',
  '/portal-do-cliente',
  '/agente-de-conteudo-ia',
  '/afiliados',
  '/blog',
  '/novidades',
];

/**
 * Reachable in the app (App Review wants the privacy policy one tap away), but opened
 * in Safari so the marketing chrome never renders in the web view.
 */
const SITE_PAGES = ['/politica-de-privacidade', '/termos-de-uso', '/lgpd'];

/** Pathname of an in-app path or of a URL on the public site; null for anything else. */
function sitePathname(pathOrUrl: string): string | null {
  const raw = pathOrUrl.trim();
  if (!raw) return null;
  if (raw.startsWith('/') && !raw.startsWith('//')) {
    return raw.split(/[?#]/, 1)[0];
  }
  try {
    const url = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (!SITE_HOSTS.has(url.hostname.toLowerCase())) return null;
    return url.pathname;
  } catch {
    return null;
  }
}

function normalize(pathname: string): string {
  const lower = pathname.toLowerCase();
  return lower.length > 1 ? lower.replace(/\/+$/, '') || '/' : lower;
}

/**
 * True for a path (or a URL on www.mesaas.com.br / mesaas.com.br) the app never shows.
 * Callers check `isNativeApp()` themselves.
 */
export function isBlockedInNativeApp(pathOrUrl: string): boolean {
  const pathname = sitePathname(pathOrUrl);
  if (pathname === null) return false;
  const path = normalize(pathname);
  if (path === '/') return true;
  return BLOCKED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

const LINK_PATTERNS = [
  // Markdown link target: [text](url) or [text](<url>)
  /\]\(\s*<?([^)\s>]+)/g,
  // HTML anchor
  /href\s*=\s*["']([^"']+)["']/gi,
  // Bare URL (GFM autolinks these)
  /(https?:\/\/[^\s)<>"']+)/gi,
  // GFM also autolinks www. without a scheme
  /(?:^|[^/\w.])(www\.mesaas\.com\.br[^\s)<>"']*)/gi,
];

/** True when markdown/HTML text links anywhere the app never shows. */
export function containsBlockedLink(text: string | null | undefined): boolean {
  if (!text) return false;
  for (const pattern of LINK_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const target = match[1].startsWith('www.') ? `https://${match[1]}` : match[1];
      if (isBlockedInNativeApp(target)) return true;
    }
  }
  return false;
}

/** Absolute URL of a public site page. */
export function publicSiteUrl(pathname: string): string {
  return `${SITE_ORIGIN}${pathname}`;
}

/**
 * Inside the app, opens Privacidade / Termos / LGPD in Safari through the MesaasNative
 * plugin and returns true. Returns false on the web, for any other path, and on an older
 * app binary without the plugin, so the caller falls back to its normal navigation.
 */
export function openSitePageInNativeApp(path: string): boolean {
  if (!isNativeApp()) return false;
  const pathname = sitePathname(path);
  if (pathname === null || !SITE_PAGES.includes(normalize(pathname))) return false;
  const plugin = getMesaasNative();
  if (!plugin) return false;
  try {
    void Promise.resolve(plugin.openUrl({ url: publicSiteUrl(normalize(pathname)) })).catch(
      () => {},
    );
  } catch {
    // A synchronous throw from the bridge: nothing to fall back to without a double open.
  }
  return true;
}
