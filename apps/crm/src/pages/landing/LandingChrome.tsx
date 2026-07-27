import { useEffect, useState } from 'react';
import { ArrowRight, Instagram, Linkedin, LogIn, Moon, Sun, Youtube } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

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

const NAV_ITEMS = [
  { id: 'features', label: 'Funcionalidades' },
  { id: 'agente', label: 'Agente IA' },
  { id: 'how', label: 'Como funciona' },
  { id: 'pricing', label: 'Preços' },
  { id: 'faq', label: 'FAQ' },
];

export function LandingHeader({ variant }: { variant: 'landing' | 'subpage' }) {
  const { user, loading } = useAuth();
  const [isDark, setIsDark] = useState(
    document.documentElement.getAttribute('data-theme') === 'dark',
  );

  const toggleTheme = () => {
    const next = !isDark;
    if (next) document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    setIsDark(next);
  };

  return (
    <header className="site-hdr">
      <div className="hdr-inner">
        <a
          href={variant === 'landing' ? '#top' : '/'}
          aria-label="Mesaas"
          style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}
        >
          <img src="/logo-black.svg" className="hdr-logo logo-light" alt="" />
          <img src="/logo-white.svg" className="hdr-logo logo-dark" alt="" />
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
          <button onClick={toggleTheme} className="theme-toggle" aria-label="Alternar tema">
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          {!loading &&
            (user ? (
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
            ))}
        </div>
      </div>
    </header>
  );
}

export function LandingFooter() {
  return (
    <footer className="lp-footer">
      <div className="lp-container">
        <div className="footer-grid">
          <div className="footer-col">
            <img src="/logo-black.svg" style={{ height: 22 }} className="logo-light" alt="Mesaas" />
            <img src="/logo-white.svg" style={{ height: 22 }} className="logo-dark" alt="Mesaas" />
            <p className="footer-tag">
              Gestão inteligente para social media managers. Feito no Brasil, pensado para quem
              entrega conteúdo todo dia.
            </p>
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
                <a href="/precos">Planos e preços</a>
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
            </ul>
          </div>
        </div>
      </div>
      <div className="footer-bottom">
        <span>
          © 2025 Mesaas. Todos os direitos reservados. · CNPJ 63.758.902/0001-01 — EBS IT SOLUTIONS
        </span>
        <div className="footer-socials">
          <a href="https://www.instagram.com/mesaas.com.br/">
            <Instagram size={18} />
          </a>
          <a href="#">
            <Linkedin size={18} />
          </a>
          <a href="#">
            <Youtube size={18} />
          </a>
        </div>
      </div>
    </footer>
  );
}
