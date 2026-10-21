import { Link } from 'react-router-dom';
import { CookiePreferencesLink } from '@/components/consent/CookiePreferencesLink';

const CONTACT_EMAIL = 'eduardo@mesaas.com.br';

const footerLink = 'text-muted-foreground hover:text-foreground';

/**
 * Moldura das páginas públicas do programa de afiliados (/afiliados, /afiliados/entrar,
 * /afiliados/painel): cabeçalho com o logo, rodapé e a classe `afiliados-page`, que dá aos
 * títulos a fonte e o espaçamento dos títulos do app (style.css).
 */
export default function AfiliadosLayout({
  logoTo = '/afiliados',
  headerRight,
  children,
}: {
  logoTo?: string;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="afiliados-page flex min-h-screen flex-col bg-background text-foreground">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-5">
        <Link to={logoTo} aria-label="Programa de afiliados Mesaas">
          <img src="/logo-black.svg" alt="Mesaas" className="h-5 w-auto dark:hidden" />
          <img src="/logo-white.svg" alt="Mesaas" className="hidden h-5 w-auto dark:block" />
        </Link>
        {headerRight}
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-16">{children}</main>

      <footer className="border-t border-border bg-card">
        <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-10 md:flex-row md:justify-between">
          <div className="max-w-xs">
            <img src="/logo-black.svg" alt="Mesaas" className="h-4 w-auto dark:hidden" />
            <img src="/logo-white.svg" alt="Mesaas" className="hidden h-4 w-auto dark:block" />
            <p className="mt-3 text-sm text-muted-foreground">
              Gestão para quem vive de social media. Feito no Brasil.
            </p>
          </div>
          <nav aria-label="Rodapé" className="grid grid-cols-2 gap-8 text-sm sm:grid-cols-3">
            <div className="flex flex-col gap-2">
              <p className="font-medium">Programa</p>
              <Link to="/afiliados" className={footerLink}>
                Programa de afiliados
              </Link>
              <Link to="/afiliados/painel" className={footerLink}>
                Painel do afiliado
              </Link>
              <a href="/" className={footerLink}>
                Conheça o Mesaas
              </a>
            </div>
            <div className="flex flex-col gap-2">
              <p className="font-medium">Legal</p>
              <a href="/termos-de-uso" className={footerLink}>
                Termos de uso
              </a>
              <a href="/politica-de-privacidade" className={footerLink}>
                Privacidade
              </a>
              <a href="/lgpd" className={footerLink}>
                LGPD
              </a>
              <CookiePreferencesLink className={`text-left ${footerLink}`} />
            </div>
            <div className="flex flex-col gap-2">
              <p className="font-medium">Dúvidas</p>
              <a href={`mailto:${CONTACT_EMAIL}`} className={`break-all ${footerLink}`}>
                {CONTACT_EMAIL}
              </a>
            </div>
          </nav>
        </div>
        <p className="mx-auto max-w-5xl px-4 pb-8 text-xs text-muted-foreground">
          © {new Date().getFullYear()} Mesaas
        </p>
      </footer>
    </div>
  );
}
