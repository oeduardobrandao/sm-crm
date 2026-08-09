import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowRight, Sparkles, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
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
import { LandingHeader, LandingFooter, useLandingChrome, scrollTo } from './LandingChrome';
import { PricingSection } from './PricingSection';
import { FaqSection } from './FaqSection';

import './landing.css';

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
    <div ref={rootRef} className="lp-root">
      <PromoBanner />
      <LandingHeader variant="landing" />
      <main>
        <Hero />
        <Ticker />
        <Features />
        <AgentSection />
        <HowItWorks />
        <Testimonial />
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
        <strong>30 dias grátis</strong> em qualquer plano pago. Sem código, cancele quando quiser.
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
                    Começar teste grátis <ArrowRight size={16} />
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
              Começar teste grátis <ArrowRight size={16} />
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

function CtaFinal() {
  const { user, loading } = useAuth();

  return (
    <section className="cta-final-wrap">
      <div className="lp-container">
        <div className="cta-final-card reveal">
          <img
            src="/icon.svg"
            width={250}
            height={170}
            style={{ height: 44, width: 'auto', margin: '0 auto 22px', display: 'block' }}
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
                Começar teste grátis <ArrowRight size={16} />
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
