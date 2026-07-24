import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  ChevronDown,
  Instagram,
  Linkedin,
  LogIn,
  Moon,
  Sparkles,
  Sun,
  X,
  Youtube,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { listPublicPricingPlans, type PublicPricingPlan } from '@/services/billing';
import { LANDING } from '@/content/landing.content';
import { usePageMeta } from '@/lib/usePageMeta';

import {
  AgentVisual,
  CalendarVisual,
  Calendar as CalendarIcon,
  CircleDollarSign,
  FinanceVisual,
  HeroDemo,
  HubVisual,
  IconSquare,
  InstagramVisual,
  Instagram as InstagramIcon,
  KanbanVisual,
  LayoutGrid,
  SchedulingVisual,
  Send,
  Users,
} from './landing-visuals';
import PlanComparison from './PlanComparison';

import './landing.css';

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
}

/** Centavos → display string. R$ 0 stays "R$ 0"; otherwise pt-BR currency (e.g. R$ 99,90). */
function formatPrice(centavos: number): string {
  if (centavos === 0) return 'R$ 0';
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Some landing.content.ts strings embed literal `<strong>…</strong>` markup
 * (kept from the original inline JSX emphasis, e.g. "<strong>5 etapas
 * padrão</strong> — ideia, ..."). This parses only that one literal tag pair
 * into a real `<strong>` element — never dangerouslySetInnerHTML — every
 * other part of the string renders as plain text. */
function withEmphasis(text: string): ReactNode[] {
  return text.split(/(<strong>.*?<\/strong>)/g).map((part, i) => {
    const match = /^<strong>(.*)<\/strong>$/.exec(part);
    return match ? <strong key={i}>{match[1]}</strong> : part;
  });
}

export default function LandingPage() {
  usePageMeta('/');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.body.classList.add('landing-page');
    return () => document.body.classList.remove('landing-page');
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const els = root.querySelectorAll('.reveal');
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div ref={rootRef} className="lp-root">
      <PromoBanner />
      <Header />
      <Hero />
      <Ticker />
      <Features />
      <AgentSection />
      <HowItWorks />
      <Testimonial />
      <Pricing />
      <Faq />
      <CtaFinal />
      <Footer />
    </div>
  );
}

// Launch promo code — must match LAUNCH_PROMO.code in the billing-checkout edge function.
const PROMO_CODE = 'BEMVINDO';

function PromoBanner() {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem('mesaas_promo_dismissed') === '1',
  );
  if (dismissed) return null;
  return (
    <div className="promo-banner" role="region" aria-label="Oferta de lançamento">
      <span className="promo-banner-text">
        🎁 <strong>1º mês grátis</strong> em qualquer plano para novos usuários — use o código{' '}
        <code className="promo-code">{PROMO_CODE}</code> no checkout.
      </span>
      <a href="/login?tab=register" className="promo-banner-cta">
        Criar conta grátis
      </a>
      <button
        className="promo-banner-close"
        aria-label="Fechar aviso"
        onClick={() => {
          localStorage.setItem('mesaas_promo_dismissed', '1');
          setDismissed(true);
        }}
      >
        <X size={16} />
      </button>
    </div>
  );
}

function Header() {
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
          href="#top"
          style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}
        >
          <img src="/logo-black.svg" className="hdr-logo logo-light" alt="Mesaas" />
          <img src="/logo-white.svg" className="hdr-logo logo-dark" alt="Mesaas" />
        </a>
        <nav className="hdr-nav">
          <button onClick={() => scrollTo('features')}>Funcionalidades</button>
          <button onClick={() => scrollTo('agente')}>Agente IA</button>
          <button onClick={() => scrollTo('how')}>Como funciona</button>
          <button onClick={() => scrollTo('pricing')}>Preços</button>
          <button onClick={() => scrollTo('faq')}>FAQ</button>
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

function Hero() {
  const { user, loading } = useAuth();

  return (
    <section className="hero-wrap" id="top">
      <div className="lp-container">
        <div className="hero-grid">
          <div>
            <span className="eyebrow-pill">{LANDING.hero.eyebrow}</span>
            <h1 className="hero-title">
              {LANDING.hero.titleBefore}
              <em>{LANDING.hero.titleEm}</em>
              {LANDING.hero.titleAfter}
            </h1>
            <p className="hero-sub">{LANDING.hero.sub}</p>
            <div className="hero-ctas">
              {!loading &&
                (user ? (
                  <a href="/dashboard" className="lp-btn lp-btn-primary lg">
                    Acessar painel <ArrowRight size={16} />
                  </a>
                ) : (
                  <a href="/login?tab=register" className="lp-btn lp-btn-primary lg">
                    Criar conta grátis <ArrowRight size={16} />
                  </a>
                ))}
              <button onClick={() => scrollTo('features')} className="lp-btn lp-btn-outline lg">
                Ver como funciona
              </button>
            </div>
          </div>
          <div className="hero-stage">
            <HeroDemo />
          </div>
        </div>
      </div>
    </section>
  );
}

function Ticker() {
  const doubled = [...LANDING.ticker, ...LANDING.ticker];
  return (
    <div className="ticker" aria-hidden="true">
      <div className="ticker-track">
        {doubled.map((t, i) => (
          <span className="ticker-item" key={i}>
            <span className="bullet" />
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

const FEATURE_VISUALS: { icon: ReactNode; color: string; visual: ReactNode }[] = [
  { icon: <LayoutGrid size={22} />, color: '#FFBF30', visual: <KanbanVisual /> },
  { icon: <Send size={22} />, color: '#3984FF', visual: <SchedulingVisual /> },
  { icon: <InstagramIcon size={22} />, color: '#f542c8', visual: <InstagramVisual /> },
  { icon: <Users size={22} />, color: '#42c8f5', visual: <HubVisual /> },
  { icon: <CalendarIcon size={22} />, color: '#3ecf8e', visual: <CalendarVisual /> },
  { icon: <CircleDollarSign size={22} />, color: '#6b7280', visual: <FinanceVisual /> },
];

function Features() {
  return (
    <section className="lp-pad" id="features">
      <div className="lp-container">
        <div className="section-head reveal">
          <span className="eyebrow-pill">Funcionalidades</span>
          <h2>{LANDING.featuresTitle}</h2>
          <p>{LANDING.featuresSub}</p>
        </div>

        {LANDING.features.map((feature, i) => {
          const { icon, color, visual } = FEATURE_VISUALS[i];
          const reverse = i % 2 === 1;
          return (
            <div key={feature.title} className={`feat-row${reverse ? ' reverse' : ''} reveal`}>
              <div className="feat-copy">
                <IconSquare icon={icon} color={color} />
                <h3>{feature.title}</h3>
                <p>{withEmphasis(feature.description)}</p>
                {feature.bullets.length > 0 && (
                  <ul className="feat-bullets">
                    {feature.bullets.map((bullet, j) => (
                      <li key={j}>
                        <span className="check">✓</span>
                        <span>{withEmphasis(bullet)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="feat-visual">{visual}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function AgentSection() {
  return (
    <section className="agent-wrap" id="agente">
      <div className="lp-container">
        <div className="agent-grid reveal">
          <div className="agent-copy">
            <span className="agent-eyebrow">
              <Sparkles size={14} /> Novo · Agente de IA
            </span>
            <h2>{LANDING.agente.title}</h2>
            {LANDING.agente.paragraphs.map((paragraph, i) => (
              <p key={i}>{withEmphasis(paragraph)}</p>
            ))}
            <ul className="agent-bullets">
              {LANDING.agente.bullets.map((bullet, i) => (
                <li key={i}>
                  <span className="check">✓</span>
                  <span>{withEmphasis(bullet)}</span>
                </li>
              ))}
            </ul>
            <a href="/login?tab=register" className="lp-btn lp-btn-primary lg">
              Criar conta grátis <ArrowRight size={16} />
            </a>
          </div>
          <div className="agent-visual">
            <AgentVisual />
          </div>
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="lp-pad lp-pad-alt" id="how">
      <div className="lp-container">
        <div className="section-head reveal">
          <span className="eyebrow-pill">Do zero em 5 minutos</span>
          <h2>{LANDING.how.title}</h2>
        </div>
        <div className="how-grid">
          {LANDING.how.steps.map((s, i) => (
            <div key={i} className="how-step reveal">
              <span className="how-num">{s.n}</span>
              <span className="eyebrow-micro">Passo {s.n}</span>
              <h3>{s.title}</h3>
              <p>{s.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Testimonial() {
  return (
    <section className="quote-wrap">
      <div className="quote-card reveal">
        <div className="quote-mark">"</div>
        <blockquote>
          O Mesaas mudou completamente a forma como gerencio meus clientes. Antes eu vivia perdida
          em planilhas e grupos de WhatsApp — agora tudo fica em um só lugar e consigo entregar com
          muito mais qualidade e no prazo.
        </blockquote>
        <cite>
          <div className="quote-avatar">DK</div>
          <div className="quote-who">
            <div className="n">Débora Kristin</div>
            <div className="r">Founder · DK Marketing Médico</div>
          </div>
        </cite>
      </div>
    </section>
  );
}

const PLAN_MARKETING: Record<string, { description: string; cta: string; highlight?: boolean }> = {
  free: {
    description: 'Para conhecer a plataforma.',
    cta: 'Começar grátis',
  },
  start: {
    description: 'Para freelancers que estão começando.',
    cta: 'Assinar Start',
  },
  pro: {
    description: 'Para freelancers com carteira consolidada.',
    cta: 'Assinar Pro',
    highlight: true,
  },
  max: {
    description: 'Para micro-agências e equipes completas.',
    cta: 'Assinar Max',
  },
};

function displayLimit(limit: number | null): string {
  return limit == null ? 'Ilimitado' : String(limit);
}

function annualSavingsPct(plans: PublicPricingPlan[]): number {
  return plans.reduce((best, plan) => {
    if (!plan.price_brl || !plan.price_brl_annual) return best;
    const saving = Math.round((1 - plan.price_brl_annual / (plan.price_brl * 12)) * 100);
    return Math.max(best, saving);
  }, 0);
}

function Pricing() {
  const { user } = useAuth();
  const [period, setPeriod] = useState<'month' | 'year'>('month');
  const pricingRef = useRef<HTMLElement>(null);
  const [shouldLoadPlans, setShouldLoadPlans] = useState(false);

  useEffect(() => {
    const section = pricingRef.current;
    if (!section) return;
    if (typeof IntersectionObserver === 'undefined') {
      setShouldLoadPlans(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setShouldLoadPlans(true);
        observer.disconnect();
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  const {
    data: plans = [],
    isPending,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['landing', 'pricing-plans'],
    queryFn: listPublicPricingPlans,
    enabled: shouldLoadPlans,
    staleTime: 5 * 60_000,
  });

  const savingsPct = annualSavingsPct(plans);

  const isYear = period === 'year';
  const isLoadingPlans = !shouldLoadPlans || isPending;

  // Visitors must sign up before checkout; logged-in owners pick/confirm on Plano & Cobrança.
  const planHref = (id: string) => {
    if (id === 'free') return user ? '/dashboard' : '/login?tab=register';
    return user ? '/configuracao/cobranca' : '/login?tab=register';
  };

  const planAction = (plan: PublicPricingPlan) => {
    const marketing = PLAN_MARKETING[plan.id] ?? {
      description: `Conheça o plano ${plan.name}.`,
      cta: `Assinar ${plan.name}`,
    };
    return {
      href: planHref(plan.id),
      label: plan.id === 'free' && user ? 'Acessar painel' : marketing.cta,
      primary: marketing.highlight,
    };
  };

  return (
    <section ref={pricingRef} className="lp-pad" id="pricing">
      <div className="lp-container">
        <div className="section-head reveal">
          <span className="eyebrow-pill">Planos e preços</span>
          <h2>Um plano que cresce junto com a sua agência.</h2>
          <p>
            Comece com o plano Free e mude de plano quando quiser. Sem fidelidade — cancele a
            qualquer momento.
          </p>
          <div className="pricing-promo-note">
            🎁 Novos usuários ganham o <strong>1º mês grátis</strong> em qualquer plano — use o
            código <code className="promo-code">{PROMO_CODE}</code> no checkout.
          </div>
        </div>

        <div className="pricing-toggle-row reveal">
          <div className="pricing-toggle" role="group" aria-label="Período de cobrança">
            <button aria-pressed={!isYear} onClick={() => setPeriod('month')}>
              Mensal
            </button>
            <button aria-pressed={isYear} onClick={() => setPeriod('year')}>
              Anual
            </button>
          </div>
          {savingsPct > 0 && (
            <span className="pricing-save">Economize até {savingsPct}% no plano anual</span>
          )}
        </div>

        <div className="plans-grid" aria-busy={isLoadingPlans}>
          {isLoadingPlans ? (
            <>
              <span className="pricing-loading-status" role="status">
                Carregando planos
              </span>
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="plan-card plan-card-skeleton" aria-hidden="true">
                  <span className="pricing-sk pricing-sk--name" />
                  <span className="pricing-sk pricing-sk--price" />
                  <span className="pricing-sk pricing-sk--description" />
                  <span className="pricing-sk pricing-sk--line" />
                  <span className="pricing-sk pricing-sk--line" />
                  <span className="pricing-sk pricing-sk--button" />
                </div>
              ))}
            </>
          ) : isError ? (
            <div className="pricing-state" role="alert">
              <p>Não foi possível carregar os planos agora.</p>
              <button type="button" className="lp-btn lp-btn-outline" onClick={() => refetch()}>
                Tentar novamente
              </button>
            </div>
          ) : plans.length === 0 ? (
            <div className="pricing-state">
              <p>Os planos estão temporariamente indisponíveis.</p>
            </div>
          ) : (
            plans.map((plan) => {
              const marketing = PLAN_MARKETING[plan.id] ?? {
                description: `Conheça o plano ${plan.name}.`,
                cta: `Assinar ${plan.name}`,
              };
              const hasAnnualPrice = plan.price_brl_annual != null && plan.price_brl_annual > 0;
              const isFree = plan.price_brl === 0 && plan.price_brl_annual === 0;
              const amount = isYear
                ? isFree
                  ? 0
                  : hasAnnualPrice
                    ? plan.price_brl_annual! / 12
                    : null
                : plan.price_brl;
              return (
                <div
                  key={plan.id}
                  className={`plan-card${marketing.highlight ? ' highlight' : ''}`}
                >
                  {marketing.highlight && <div className="plan-badge">Mais popular</div>}
                  <h3>{plan.name}</h3>
                  <div className="price-row">
                    <span className="price">
                      {amount == null ? 'Sob consulta' : formatPrice(amount)}
                    </span>
                    {amount != null && <span className="price-sub">/mês</span>}
                  </div>
                  <div className="price-annual-note">
                    {isYear && plan.price_brl_annual != null && plan.price_brl_annual > 0
                      ? `cobrado anualmente (${formatPrice(plan.price_brl_annual)}/ano)`
                      : ' '}
                  </div>
                  <div className="plan-tag">{marketing.description}</div>
                  <div className="plan-label">Limites</div>
                  <ul className="plan-list plan-limits">
                    <li>
                      <span className="k">Clientes</span>
                      <span className="v">{displayLimit(plan.max_clients)}</span>
                    </li>
                    <li>
                      <span className="k">Usuários</span>
                      <span className="v">{displayLimit(plan.max_team_members)}</span>
                    </li>
                  </ul>
                  <div className="plan-cta">
                    <a
                      href={planHref(plan.id)}
                      className={`lp-btn ${marketing.highlight ? 'lp-btn-primary' : 'lp-btn-outline'}`}
                    >
                      {plan.id === 'free' && user ? 'Acessar painel' : marketing.cta}
                    </a>
                  </div>
                </div>
              );
            })
          )}
        </div>
        {!isLoadingPlans && !isError && plans.length > 0 && (
          <PlanComparison plans={plans} actionFor={planAction} />
        )}
      </div>
    </section>
  );
}

function Faq() {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <section className="lp-pad lp-pad-alt" id="faq">
      <div className="lp-container">
        <div className="section-head reveal">
          <span className="eyebrow-pill">FAQ</span>
          <h2>Perguntas frequentes</h2>
        </div>
        <div className="faqs">
          {LANDING.faq.map((item, i) => (
            <div key={i} className="faq-item">
              <button
                onClick={() => setOpen(open === i ? null : i)}
                aria-expanded={open === i}
                aria-controls={`faq-answer-${i}`}
              >
                <span>{item.q}</span>
                <ChevronDown className={`faq-chevron ${open === i ? 'open' : ''}`} />
              </button>
              {open === i && (
                <div id={`faq-answer-${i}`} className="ans">
                  {item.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CtaFinal() {
  const { user, loading } = useAuth();

  return (
    <section className="cta-final-wrap">
      <div className="lp-container">
        <div className="cta-final-card reveal">
          <img
            src="/icon.svg"
            style={{ height: 44, margin: '0 auto 22px', display: 'block' }}
            alt=""
          />
          {user ? (
            <>
              <h2>Bem-vindo de volta!</h2>
              <p>Sua conta já está ativa. Acesse seu painel e continue organizando sua agência.</p>
            </>
          ) : (
            <>
              <h2>Pronto para sair das planilhas?</h2>
              <p>
                Crie sua conta grátis e comece a organizar sua agência hoje. Sem cartão, sem
                compromisso.
              </p>
            </>
          )}
          {!loading &&
            (user ? (
              <a href="/dashboard" className="lp-btn lp-btn-primary lg">
                Acessar painel <ArrowRight size={16} />
              </a>
            ) : (
              <a href="/login?tab=register" className="lp-btn lp-btn-primary lg">
                Criar conta grátis <ArrowRight size={16} />
              </a>
            ))}
          <div
            style={{
              marginTop: 18,
              fontSize: '.8rem',
              color: '#9ca3af',
              fontFamily: "-apple-system,'SF Pro Display','Plus Jakarta Sans',system-ui,sans-serif",
              letterSpacing: '.08em',
            }}
          >
            Comece grátis · sem cartão de crédito
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
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
                <a href="#features">Funcionalidades</a>
              </li>
              <li>
                <a href="#how">Como funciona</a>
              </li>
              <li>
                <a href="#pricing">Preços</a>
              </li>
              <li>
                <a href="#faq">FAQ</a>
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
