import { useEffect, useSyncExternalStore } from 'react';
import { ArrowRight, Instagram, Linkedin, LogIn, Moon, Sun, Youtube } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { CookiePreferencesLink } from '@/components/consent/CookiePreferencesLink';
import { useIsHydrated } from '@/lib/useIsHydrated';
import { isSsrMount } from '@/lib/ssrMount';

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

const NAV_ITEMS = [
  { id: 'features', label: 'Funcionalidades' },
  { id: 'agente', label: 'Agente IA' },
  { id: 'how', label: 'Como funciona' },
  { id: 'pricing', label: 'Preços' },
  { id: 'faq', label: 'FAQ' },
];

export function SkipLink() {
  return (
    <a className="skip-link" href="#main-content">
      Pular para o conteúdo
    </a>
  );
}

/** `skipLink={false}` when the page renders <SkipLink /> itself, ahead of content that
 * precedes the header in tab order (the landing promo banner). */
export function LandingHeader({
  variant,
  skipLink = true,
}: {
  variant: 'landing' | 'subpage';
  skipLink?: boolean;
}) {
  const { user, ready } = useLandingAuth();
  const isDark = useSyncExternalStore(subscribeTheme, readIsDark, () => false);

  const toggleTheme = () => {
    if (!readIsDark()) document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
  };

  return (
    <>
      {skipLink && <SkipLink />}
      <header className="site-hdr">
        <div className="hdr-inner">
          <a
            href={variant === 'landing' ? '#top' : '/'}
            aria-label="Mesaas"
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
              ? NAV_ITEMS.map((item) => (
                  <button key={item.id} onClick={() => scrollTo(item.id)}>
                    {item.label}
                  </button>
                ))
              : NAV_ITEMS.map((item) => (
                  <a key={item.id} href={`/#${item.id}`}>
                    {item.label}
                  </a>
                ))}
          </nav>
          <div className="hdr-actions">
            {/* The redesigned landing is always dark; the toggle only applies to subpages. */}
            {variant === 'subpage' && (
              <button onClick={toggleTheme} className="theme-toggle" aria-label="Alternar tema">
                {isDark ? <Sun size={18} /> : <Moon size={18} />}
              </button>
            )}
            {!ready ? null : user ? (
              <a href="/dashboard" className="lp-btn lp-btn-primary">
                Acessar painel <ArrowRight size={14} />
              </a>
            ) : (
              <>
                <a href="/login" className="link">
                  <LogIn size={15} />
                  Entrar
                </a>
                <a href="/login?tab=register" className="lp-btn lp-btn-primary">
                  Criar conta grátis
                </a>
              </>
            )}
          </div>
        </div>
      </header>
    </>
  );
}

export function LandingFooter() {
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
            <p className="footer-tag">Gestão para quem vive de social media. Feito no Brasil.</p>
          </div>
          <div className="footer-col">
            <p className="ft-label">Produto</p>
            <ul>
              <li>
                <a href="/#features">Funcionalidades</a>
              </li>
              <li>
                <a href="/#how">Como funciona</a>
              </li>
              <li>
                <a href="/#pricing">Preços</a>
              </li>
              <li>
                <a href="/#faq">FAQ</a>
              </li>
              <li>
                <a href="/aprovacao-de-post">Aprovação de posts</a>
              </li>
              <li>
                <a href="/portal-do-cliente">Portal do cliente</a>
              </li>
              <li>
                <a href="/agente-de-conteudo-ia">Agente de conteúdo IA</a>
              </li>
              <li>
                <a href="/sobre">Sobre</a>
              </li>
              <li>
                <a href="/novidades">Novidades</a>
              </li>
              <li>
                <a href="/blog">Blog</a>
              </li>
            </ul>
          </div>
          <div className="footer-col">
            <p className="ft-label">Legal</p>
            <ul>
              <li>
                <a href="/politica-de-privacidade">Privacidade</a>
              </li>
              <li>
                <a href="/termos-de-uso">Termos de uso</a>
              </li>
              <li>
                <a href="/lgpd">LGPD</a>
              </li>
              <li>
                <CookiePreferencesLink className="cookie-prefs-link" />
              </li>
            </ul>
          </div>
        </div>
      </div>
      <div className="footer-bottom">
        <span>
          {`© ${__BUILD_YEAR__} Mesaas. Todos os direitos reservados. · CNPJ 63.758.902/0001-01 — EBS IT SOLUTIONS`}
        </span>
        <div className="footer-socials">
          <a href="https://www.instagram.com/mesaas.com.br/" aria-label="Instagram do Mesaas">
            <Instagram size={18} />
          </a>
          <a href="#" aria-label="LinkedIn do Mesaas">
            <Linkedin size={18} />
          </a>
          <a href="#" aria-label="YouTube do Mesaas">
            <Youtube size={18} />
          </a>
        </div>
      </div>
    </footer>
  );
}
