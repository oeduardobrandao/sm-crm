import { useEffect, useSyncExternalStore } from 'react';
import { ArrowRight, Instagram, Linkedin, LogIn, Moon, Sun, Youtube } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { CookiePreferencesLink } from '@/components/consent/CookiePreferencesLink';
import { doNotSellOrShare } from '@/lib/usConsentDefault';
import { useIsHydrated } from '@/lib/useIsHydrated';
import { isSsrMount } from '@/lib/ssrMount';
import { landingContent, localizedPath, signupHref, type SiteLocale } from '@/content/locale';

export function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
}

/** Adds the `landing-page` body class scoping for the duration of the mounted
 * page, so landing subpages get the same styling scope as the landing page. */
export function useLandingChrome(): void {
  useEffect(() => {
    document.body.classList.add('landing-page');
    return () => document.body.classList.remove('landing-page');
  }, []);
}

/**
 * What the landing CTAs render from.
 *
 * `user`: the signed-in user; `null` on the server, during hydration, and while auth is loading
 * on a page that hydrated server HTML. The prerendered `/` always carries the anonymous CTAs; a
 * signed-in visitor sees them switch to "Acessar painel" once auth resolves, with no hydration
 * mismatch.
 *
 * `ready`: whether the auth-dependent CTAs render at all. A page that hydrated server HTML keeps
 * the anonymous CTAs while auth loads (they are in the HTML and must neither mismatch nor vanish
 * after hydration). A plain `createRoot` mount (a cold open of /precos, /sobre..., or an SPA
 * navigation to `/`) renders no CTA until auth resolves, so a signed-in visitor never sees
 * "Entrar" flash before "Acessar painel".
 */
export function useLandingAuth(): { user: ReturnType<typeof useAuth>['user']; ready: boolean } {
  const { user, loading } = useAuth();
  const hydrated = useIsHydrated();
  const ssrMount = isSsrMount();
  return {
    // Hydrated page: anonymous until auth resolves. `createRoot` mount: whatever auth has, as
    // before SSR existed (PricingSection reads it ungated).
    user: !hydrated || (ssrMount && loading) ? null : user,
    ready: !hydrated || ssrMount || !loading,
  };
}

/** The signed-in user per {@link useLandingAuth}, for places that render no matter what. */
export function useLandingUser() {
  return useLandingAuth().user;
}

function readIsDark(): boolean {
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

/** Follows `data-theme` on <html>, whoever sets it. Server snapshot: light. */
function subscribeTheme(listener: () => void): () => void {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

export function SkipLink({ locale = 'pt' }: { locale?: SiteLocale }) {
  return (
    <a className="skip-link" href="#main-content">
      {landingContent(locale).chrome.skipLink}
    </a>
  );
}

/** `skipLink={false}` when the page renders <SkipLink /> itself (the landing does, as the
 * first element of the page). */
export function LandingHeader({
  variant,
  skipLink = true,
  locale = 'pt',
}: {
  variant: 'landing' | 'subpage';
  skipLink?: boolean;
  locale?: SiteLocale;
}) {
  const { user, ready } = useLandingAuth();
  const { chrome, nav } = landingContent(locale);
  const home = localizedPath(locale, 'home');
  const isDark = useSyncExternalStore(subscribeTheme, readIsDark, () => false);

  const toggleTheme = () => {
    if (!readIsDark()) document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
  };

  return (
    <>
      {skipLink && <SkipLink locale={locale} />}
      <header className="site-hdr">
        <div className="hdr-inner">
          <a
            href={variant === 'landing' ? '#top' : home}
            aria-label={chrome.logoLabel}
            style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}
          >
            <img
              src="/logo-black.svg"
              width={1468}
              height={186}
              className="hdr-logo logo-light"
              alt=""
            />
            <img
              src="/logo-white.svg"
              width={1468}
              height={186}
              className="hdr-logo logo-dark"
              alt=""
            />
          </a>
          <nav className="hdr-nav">
            {variant === 'landing'
              ? nav.map((item) => (
                  // Real anchors so the server HTML still navigates without JS (or before hydration);
                  // with JS the click scrolls smoothly instead of jumping.
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    className="hdr-nav-link"
                    onClick={(e) => {
                      e.preventDefault();
                      scrollTo(item.id);
                    }}
                  >
                    {item.label}
                  </a>
                ))
              : nav.map((item) => (
                  <a key={item.id} href={`${home}#${item.id}`}>
                    {item.label}
                  </a>
                ))}
          </nav>
          <div className="hdr-actions">
            {/* The redesigned landing is always dark; the toggle only applies to subpages. */}
            {variant === 'subpage' && (
              <button
                onClick={toggleTheme}
                className="theme-toggle"
                aria-label={chrome.toggleTheme}
              >
                {isDark ? <Sun size={18} /> : <Moon size={18} />}
              </button>
            )}
            {!ready ? null : user ? (
              <a href="/dashboard" className="lp-btn lp-btn-primary">
                {chrome.openDashboard} <ArrowRight size={14} />
              </a>
            ) : (
              <>
                <a href="/login" className="link">
                  <LogIn size={15} />
                  {chrome.signIn}
                </a>
                {/* Both labels ship in the markup (SSR-stable); CSS shows the short one <=400px.
                    The aria-label keeps one accessible name. */}
                <a
                  href={signupHref(locale)}
                  className="lp-btn lp-btn-primary"
                  aria-label={chrome.createAccountAria}
                >
                  <span className="hdr-cta-long">{chrome.createAccount}</span>
                  <span className="hdr-cta-short" aria-hidden="true">
                    {chrome.createAccountShort}
                  </span>
                </a>
              </>
            )}
          </div>
        </div>
      </header>
    </>
  );
}

/** Footer hrefs, positional against `footer.product`. A `null` entry has no page in that market
 * and is not rendered. */
function productHrefs(locale: SiteLocale): (string | null)[] {
  if (locale === 'en') {
    const home = localizedPath('en', 'home');
    return [
      `${home}#features`,
      `${home}#how`,
      localizedPath('en', 'pricing'),
      `${home}#faq`,
      null,
      null,
      null,
      null,
      null,
      null,
    ];
  }
  return [
    '/#features',
    '/#how',
    '/#pricing',
    '/#faq',
    '/aprovacao-de-post',
    '/portal-do-cliente',
    '/agente-de-conteudo-ia',
    '/sobre',
    '/novidades',
    '/blog',
  ];
}

/** Footer hrefs, positional against `footer.legal` (pt also has the LGPD page). */
function legalHrefs(locale: SiteLocale): string[] {
  return locale === 'en'
    ? [localizedPath('en', 'privacy'), localizedPath('en', 'terms')]
    : [localizedPath('pt', 'privacy'), localizedPath('pt', 'terms'), '/lgpd'];
}

export function LandingFooter({ locale = 'pt' }: { locale?: SiteLocale }) {
  const { footer } = landingContent(locale);
  const products = productHrefs(locale);
  const legal = legalHrefs(locale);
  return (
    <footer className="lp-footer">
      <div className="lp-container">
        <div className="footer-grid">
          <div className="footer-col">
            <img
              src="/logo-black.svg"
              width={1468}
              height={186}
              style={{ height: 22, width: 'auto' }}
              className="logo-light"
              alt="Mesaas"
            />
            <img
              src="/logo-white.svg"
              width={1468}
              height={186}
              style={{ height: 22, width: 'auto' }}
              className="logo-dark"
              alt="Mesaas"
            />
            <p className="footer-tag">{footer.tagline}</p>
          </div>
          <div className="footer-col">
            <p className="ft-label">{footer.productLabel}</p>
            <ul>
              {footer.product.map((label, i) =>
                products[i] ? (
                  <li key={label}>
                    <a href={products[i]}>{label}</a>
                  </li>
                ) : null,
              )}
            </ul>
          </div>
          <div className="footer-col">
            <p className="ft-label">{footer.legalLabel}</p>
            <ul>
              {footer.legal.map((label, i) => (
                <li key={label}>
                  <a href={legal[i]}>{label}</a>
                </li>
              ))}
              <li>
                <CookiePreferencesLink className="cookie-prefs-link">
                  {footer.cookieSettings}
                </CookiePreferencesLink>
              </li>
              {footer.doNotSell && (
                <li>
                  <button
                    type="button"
                    className="cookie-prefs-link"
                    onClick={() => doNotSellOrShare()}
                  >
                    {footer.doNotSell}
                  </button>
                </li>
              )}
              <li>
                <a href={localizedPath(locale === 'en' ? 'pt' : 'en', 'home')}>
                  {footer.otherLanguage}
                </a>
              </li>
            </ul>
          </div>
        </div>
      </div>
      <div className="footer-bottom">
        <span>{footer.copyright.replace('{year}', __BUILD_YEAR__)}</span>
        <div className="footer-socials">
          <a href="https://www.instagram.com/mesaas.com.br/" aria-label={footer.instagramLabel}>
            <Instagram size={18} />
          </a>
          <a href="#" aria-label={footer.linkedinLabel}>
            <Linkedin size={18} />
          </a>
          <a href="#" aria-label={footer.youtubeLabel}>
            <Youtube size={18} />
          </a>
        </div>
      </div>
    </footer>
  );
}
