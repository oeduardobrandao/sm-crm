import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Calendar,
  CalendarCheck,
  ChevronRight,
  Kanban,
  Link2,
  MessageCircle,
  Plug,
  Sparkles,
  TrendingUp,
  X,
  Eye,
  Heart,
  Users,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { LANDING } from '@/content/landing.content';
import { usePageMeta } from '@/lib/usePageMeta';

import { HeroDevicesDark } from './landing-visuals';
import { LandingHeader, LandingFooter, useLandingChrome, scrollTo } from './LandingChrome';
import { PricingSection } from './PricingSection';
import { FaqSection } from './FaqSection';
import { Testimonials } from './Testimonials';

import './landing.css';
import './landing-v2.css';

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

/** Splits "Sentence one. Sentence two." so the second sentence renders muted
 * (the two-tone section heading). A title without a second sentence renders
 * as-is. */
function twoTone(title: string): ReactNode {
  const match = /^(.*?\.)\s+(.+)$/.exec(title);
  if (!match) return title;
  return (
    <>
      {match[1]} <span className="lp2-muted">{match[2]}</span>
    </>
  );
}

export default function LandingPage() {
  usePageMeta('/');
  const rootRef = useRef<HTMLDivElement>(null);

  useLandingChrome();

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

  // Subpage headers link to `/#features`-style hashes; honor the hash after
  // this lazy-mounted page renders its sections.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    document.getElementById(id)?.scrollIntoView();
  }, []);

  return (
    <div ref={rootRef} className="lp-root lp-v2">
      <PromoBanner />
      <LandingHeader variant="landing" />
      <main id="main-content" tabIndex={-1}>
        <Hero />
        <Ticker />
        <Features />
        <AgentSection />
        <HowItWorks />
        <Testimonials />
        <PricingSection />
        <FaqSection items={[...LANDING.faq]} />
        <CtaFinal />
      </main>
      <LandingFooter />
    </div>
  );
}

function PromoBanner() {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem('mesaas_promo_dismissed') === '1',
  );
  if (dismissed) return null;
  return (
    <div className="promo-banner" role="region" aria-label="Oferta de lançamento">
      <span className="promo-banner-text">
        <strong>30 dias grátis</strong> em qualquer plano pago. Sem cupom. Cancele quando quiser.
      </span>
      <a href="/login?tab=register" className="promo-banner-cta">
        Começar teste grátis
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

function Hero() {
  const { user, loading } = useAuth();

  return (
    <section className="hero-wrap" id="top">
      <div className="lp-container">
        <div className="lp2-hero">
          <h1 className="hero-title">
            {LANDING.hero.titleBefore}
            <em>{LANDING.hero.titleEm}</em>
            {LANDING.hero.titleAfter}
          </h1>
          <p className="hero-sub">{LANDING.hero.sub}</p>
          <div className="lp2-offer">
            <span className="lp2-offer-text">{LANDING.hero.note}</span>
            <div className="hero-ctas">
              {!loading &&
                (user ? (
                  <a href="/dashboard" className="lp-btn lp-btn-cta lg">
                    Acessar painel <ArrowRight size={16} />
                  </a>
                ) : (
                  <a href="/login?tab=register" className="lp-btn lp-btn-cta lg">
                    Começar teste grátis <ArrowRight size={16} />
                  </a>
                ))}
              <button onClick={() => scrollTo('features')} className="lp-btn lp-btn-outline lg">
                Ver como funciona
              </button>
            </div>
          </div>
          <div className="hero-stage">
            <HeroDevicesDark />
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
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

const METRIC_TILES = [
  { icon: <Users size={16} />, label: 'Seguidores', value: '45.798', delta: '+12%' },
  { icon: <Eye size={16} />, label: 'Alcance (28d)', value: '96.826', delta: '+8%' },
  { icon: <Heart size={16} />, label: 'Engajamento', value: '4,6%', delta: '+0,4 pp' },
  { icon: <TrendingUp size={16} />, label: 'Visualizações', value: '242.080', delta: '+19%' },
];

function MetricsVisual() {
  return (
    <div className="lp2-metrics">
      <ul className="lp2-kpis" aria-hidden>
        {METRIC_TILES.map((tile) => (
          <li key={tile.label} className="lp2-kpi">
            <span className="lp2-kpi-head">
              {tile.icon}
              {tile.label}
            </span>
            <span className="lp2-kpi-value">{tile.value}</span>
            <span className="lp2-kpi-delta">{tile.delta}</span>
          </li>
        ))}
      </ul>
      <img
        className="lp2-shot lp2-shot--right"
        src="/landing/feat-analytics-dark.webp"
        width={1400}
        height={1095}
        alt="Métricas do Instagram no Mesaas: seguidores, alcance e engajamento"
        loading="lazy"
        decoding="async"
      />
    </div>
  );
}

function DmVisual() {
  return (
    <div className="lp2-dm" aria-hidden="true">
      <div className="lp2-dm-comment">
        quero <span>(comentário)</span>
      </div>
      <div className="lp2-dm-reply">
        Oi! Tá aqui o guia do cardápio de inverno. Baixe grátis e escolha o seu favorito.
      </div>
      <div className="lp2-dm-btn">
        Abrir link <ArrowRight size={14} />
      </div>
    </div>
  );
}

/** Per-feature presentation for the bento grid: the eyebrow label + icon,
 * the grid cell span and the visual. Copy comes from landing.content.ts. */
const FEATURE_VISUALS: {
  eyebrow: string;
  icon: ReactNode;
  span: 1 | 2;
  visual?: ReactNode;
}[] = [
  {
    eyebrow: 'Entregas',
    icon: <Kanban size={20} />,
    span: 2,
    visual: (
      <img
        className="lp2-shot lp2-shot--bottom"
        src="/landing/feat-entregas-dark.webp"
        width={1400}
        height={1095}
        alt="Kanban de entregas do Mesaas com fluxos por etapa"
        loading="lazy"
        decoding="async"
      />
    ),
  },
  {
    eyebrow: 'Agendamento',
    icon: <CalendarCheck size={20} />,
    span: 1,
  },
  {
    eyebrow: 'Métricas',
    icon: <BarChart3 size={20} />,
    span: 2,
    visual: <MetricsVisual />,
  },
  {
    eyebrow: 'Portal do cliente',
    icon: <Link2 size={20} />,
    span: 1,
    visual: (
      <img
        className="lp2-shot lp2-shot--bleed"
        src="/landing/feat-hub-dark.webp"
        width={1400}
        height={1050}
        alt="Portal do cliente do Mesaas com aprovações por link"
        loading="lazy"
        decoding="async"
      />
    ),
  },
  {
    eyebrow: 'Calendário',
    icon: <Calendar size={20} />,
    span: 1,
    visual: (
      <img
        className="lp2-shot lp2-shot--bleed"
        src="/landing/feat-calendario-dark.webp"
        width={1400}
        height={1095}
        alt="Calendário editorial mensal do Mesaas"
        loading="lazy"
        decoding="async"
      />
    ),
  },
  {
    eyebrow: 'Automações',
    icon: <MessageCircle size={20} />,
    span: 2,
    visual: <DmVisual />,
  },
];

function Features() {
  return (
    <section className="lp-pad" id="features">
      <div className="lp-container">
        <div className="lp2-section-head reveal">
          <h2>{twoTone(LANDING.featuresTitle)}</h2>
          <p>{LANDING.featuresSub}</p>
        </div>

        <div className="lp2-bento">
          {LANDING.features.map((feature, i) => {
            const { eyebrow, icon, span, visual } = FEATURE_VISUALS[i];
            const classes = [
              'lp2-card',
              span === 2 ? 'lp2-card--wide' : '',
              visual ? 'lp2-card--visual' : '',
              i === 5 ? 'lp2-card--dm' : '',
              'reveal',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <article key={feature.title} className={classes}>
                <div className="lp2-card-copy">
                  <span className="lp2-eyebrow">
                    {icon}
                    {eyebrow}
                  </span>
                  <h3>{feature.title}</h3>
                  <p>{withEmphasis(feature.description)}</p>
                  {feature.showBullets && feature.bullets.length > 0 && (
                    <ul className="lp2-bullets">
                      {feature.bullets.map((bullet, j) => (
                        <li key={j}>{withEmphasis(bullet)}</li>
                      ))}
                    </ul>
                  )}
                </div>
                {visual && <div className="lp2-card-visual">{visual}</div>}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* Icons are positional against LANDING.agente.bullets; a bullet beyond the
 * list falls back to the generic sparkle so a copy-only edit never renders
 * a chip without an icon. */
const AGENT_CHIP_ICONS = [
  <BookOpen size={40} strokeWidth={1.6} key="briefing" />,
  <TrendingUp size={40} strokeWidth={1.6} key="performance" />,
  <Plug size={40} strokeWidth={1.6} key="connect" />,
];
const AGENT_CHIP_FALLBACK_ICON = <Sparkles size={40} strokeWidth={1.6} />;

function AgentSection() {
  return (
    <section className="agent-wrap" id="agente">
      <div className="lp-container">
        <div className="lp2-section-head lp2-section-head--center reveal">
          <span className="lp2-eyebrow">Agente de conteúdo</span>
          <h2>{LANDING.agente.title}</h2>
          {LANDING.agente.paragraphs.map((paragraph, i) => (
            <p key={i}>{withEmphasis(paragraph)}</p>
          ))}
        </div>
        <ul className="lp2-chips reveal">
          {LANDING.agente.bullets.map((bullet, i) => (
            <li key={i} className="lp2-chip">
              {AGENT_CHIP_ICONS[i] ?? AGENT_CHIP_FALLBACK_ICON}
              <span>{withEmphasis(bullet)}</span>
            </li>
          ))}
        </ul>
        <div className="lp2-center reveal">
          <a href="/login?tab=register" className="lp-btn lp-btn-primary lg">
            Começar teste grátis <ArrowRight size={16} />
          </a>
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="lp-pad lp-pad-alt" id="how">
      <div className="lp-container">
        <div className="lp2-section-head reveal">
          <h2>{twoTone(LANDING.how.title)}</h2>
          <p>Do zero ao primeiro post agendado em 5 minutos.</p>
        </div>
        <div className="how-grid">
          {LANDING.how.steps.map((s, i) => (
            <div key={i} className="how-step reveal">
              <span className="how-num">{s.n}</span>
              <h3>{s.title}</h3>
              <p>{s.description}</p>
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
          {user ? (
            <>
              <h2>Bem-vindo de volta!</h2>
              <p>Sua conta está ativa. Acesse o painel e continue de onde parou.</p>
            </>
          ) : (
            <>
              <h2>
                Pronto para sair <em>das planilhas?</em>
              </h2>
              <p>
                Crie sua conta grátis e organize seus clientes ainda hoje. Sem cartão de crédito,
                sem compromisso.
              </p>
            </>
          )}
          <div className="lp2-cta-row">
            {!loading &&
              (user ? (
                <a href="/dashboard" className="lp-btn lp-btn-cta lg">
                  Acessar painel <ArrowRight size={16} />
                </a>
              ) : (
                <>
                  <a href="/login?tab=register" className="lp-btn lp-btn-cta lg">
                    Começar teste grátis <ArrowRight size={16} />
                  </a>
                  <a href="/login" className="lp-btn lp-btn-outline lg">
                    Entrar <ChevronRight size={16} />
                  </a>
                </>
              ))}
          </div>
        </div>
      </div>
    </section>
  );
}
