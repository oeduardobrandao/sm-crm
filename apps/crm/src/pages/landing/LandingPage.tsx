import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Calendar,
  CalendarCheck,
  ChevronDown,
  ChevronRight,
  Kanban,
  Link2,
  MessageCircle,
  Plug,
  Sparkles,
  TrendingUp,
  Eye,
  Heart,
  Users,
} from 'lucide-react';
import { landingContent, localizedPath, signupHref, type SiteLocale } from '@/content/locale';
import { usePageMeta } from '@/lib/usePageMeta';

import { HeroDevicesDark } from './landing-visuals';
import { landingAsset } from './landing-images';
import {
  LandingHeader,
  LandingFooter,
  SkipLink,
  useLandingChrome,
  useLandingAuth,
  scrollTo,
} from './LandingChrome';
import { PricingSection } from './PricingSection';
import { FaqSection } from './FaqSection';
import { Testimonials } from './Testimonials';

import './landing-styles';
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

export default function LandingPage({ locale = 'pt' }: { locale?: SiteLocale }) {
  usePageMeta(localizedPath(locale, 'home'));
  const content = landingContent(locale);
  const rootRef = useRef<HTMLDivElement>(null);

  useLandingChrome();

  // The prerendered `/` ships `<div id="root" data-ssr="landing">`, and the pre-paint CSS hides
  // stored-state UI (the decided cookie banner) only under `#root[data-ssr]`. This
  // effect runs once this boundary has hydrated, in the same passive flush as the post-hydration
  // re-render, so the CSS hands over to React state without a gap (a frame may paint before it).
  useEffect(() => {
    document.getElementById('root')?.removeAttribute('data-ssr');
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

  // Subpage headers link to `/#features`-style hashes; honor the hash after
  // this lazy-mounted page renders its sections.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    document.getElementById(id)?.scrollIntoView();
  }, []);

  return (
    <div ref={rootRef} className="lp-root lp-v2">
      <SkipLink locale={locale} />
      <LandingHeader variant="landing" skipLink={false} locale={locale} />
      <main id="main-content" tabIndex={-1}>
        <Hero locale={locale} />
        <Ticker locale={locale} />
        <Features locale={locale} />
        <AgentSection locale={locale} />
        <HowItWorks locale={locale} />
        {/* Testimonials are Portuguese-speaking customers: no English counterpart yet. */}
        {locale === 'pt' && <Testimonials />}
        <PricingSection locale={locale} />
        <FaqSection items={[...content.faq]} locale={locale} />
        <CtaFinal locale={locale} />
      </main>
      <LandingFooter locale={locale} />
    </div>
  );
}

/** `hero.note` with its first sentence (`hero.noteStrong`, e.g. "14 dias de Pro grátis, sem
 * cartão.") in `<strong>`. The note itself stays plain text (the content modules are the single
 * source of the copy); the remainder keeps its leading space so the text reads on. */
function OfferNote({ note, strong }: { note: string; strong: string }) {
  const at = note.indexOf(strong);
  if (at < 0) return <>{note}</>;
  const before = note.slice(0, at);
  return (
    <>
      {before || null}
      <strong>{strong}</strong>
      <span>{note.slice(at + strong.length)}</span>
    </>
  );
}

function Hero({ locale }: { locale: SiteLocale }) {
  const { user, ready } = useLandingAuth();
  const { hero } = landingContent(locale);

  return (
    <section className="hero-wrap" id="top">
      <div className="lp-container">
        <div className="lp2-hero">
          <h1 className="hero-title">
            {hero.titleBefore}
            <em>{hero.titleEm}</em>
            {hero.titleAfter}
          </h1>
          <p className="hero-sub">{hero.sub}</p>
          <div className="lp2-offer">
            <span className="lp2-offer-text">
              <OfferNote note={hero.note} strong={hero.noteStrong} />
            </span>
            <div className="hero-ctas">
              {!ready ? null : user ? (
                <a href="/dashboard" className="lp-btn lp-btn-cta lg">
                  {hero.ctaSignedIn} <ArrowRight size={16} />
                </a>
              ) : (
                <a href={signupHref(locale)} className="lp-btn lp-btn-cta lg">
                  {hero.ctaStart} <ArrowRight size={16} />
                </a>
              )}
              <button onClick={() => scrollTo('features')} className="lp-btn lp-btn-outline lg">
                {hero.ctaSecondary}
              </button>
            </div>
          </div>
          <div className="hero-stage">
            <HeroDevicesDark locale={locale} />
          </div>
        </div>
      </div>
    </section>
  );
}

function Ticker({ locale }: { locale: SiteLocale }) {
  const { ticker } = landingContent(locale);
  const doubled = [...ticker, ...ticker];
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

/** Bento screenshots (1400px sources) with 480/760/1100w downscales. */
function featSrcSet(locale: SiteLocale, name: string) {
  return [480, 760, 1100]
    .map((w) => `${landingAsset(locale, `/landing/${name}-${w}w.webp`)} ${w}w`)
    .concat(`${landingAsset(locale, `/landing/${name}.webp`)} 1400w`)
    .join(', ');
}
/* Rendered widths from landing-v2.css. <=900px the bento is one column with
 * 24px card padding; above, it is a 3-column grid (20px gap, 44px card
 * padding) inside the 1200px container. The 130%/115% widths in the CSS are
 * capped by Tailwind preflight's `img { max-width: 100% }`, so every shot
 * lays out at 100% of its card (measured in the browser). */
const SHOT_SIZES_MOBILE =
  '(max-width: 720px) calc(100vw - 88px), (max-width: 900px) calc(100vw - 104px)';
/** .lp2-shot--bottom: a wide (span 2) card. */
const SHOT_SIZES_BOTTOM = `${SHOT_SIZES_MOBILE}, (max-width: 1200px) calc(66.67vw - 132px), 668px`;
/** .lp2-shot--bleed: a single-column card. */
const SHOT_SIZES_BLEED = `${SHOT_SIZES_MOBILE}, (max-width: 1200px) calc(33.33vw - 120px), 280px`;
/** .lp2-shot--right: full width of the wide card up to 1100px, then the
 * grid column beside the 360px copy column (+40px gap). */
const SHOT_SIZES_RIGHT = `${SHOT_SIZES_MOBILE}, (max-width: 1100px) calc(66.67vw - 132px), (max-width: 1200px) calc(66.67vw - 532px), 268px`;

/** Icons are positional against `metricTiles`. */
const METRIC_ICONS = [
  <Users size={16} key="followers" />,
  <Eye size={16} key="reach" />,
  <Heart size={16} key="engagement" />,
  <TrendingUp size={16} key="views" />,
];

function MetricsVisual({ locale }: { locale: SiteLocale }) {
  const { metricTiles, shotAlts } = landingContent(locale);
  return (
    <div className="lp2-metrics">
      <ul className="lp2-kpis" aria-hidden>
        {metricTiles.map((tile, i) => (
          <li key={tile.label} className="lp2-kpi">
            <span className="lp2-kpi-head">
              {METRIC_ICONS[i]}
              {tile.label}
            </span>
            <span className="lp2-kpi-value">{tile.value}</span>
            <span className="lp2-kpi-delta">{tile.delta}</span>
          </li>
        ))}
      </ul>
      <img
        className="lp2-shot lp2-shot--right"
        src={landingAsset(locale, '/landing/feat-analytics-dark.webp')}
        srcSet={featSrcSet(locale, 'feat-analytics-dark')}
        sizes={SHOT_SIZES_RIGHT}
        width={1400}
        height={1095}
        alt={shotAlts.analytics}
        loading="lazy"
        decoding="async"
      />
    </div>
  );
}

function DmVisual({ locale }: { locale: SiteLocale }) {
  const { dmVisual } = landingContent(locale);
  return (
    <div className="lp2-dm" aria-hidden="true">
      <div className="lp2-dm-comment">
        {dmVisual.comment} <span>{dmVisual.commentTag}</span>
      </div>
      <div className="lp2-dm-reply">{dmVisual.reply}</div>
      <div className="lp2-dm-btn">
        {dmVisual.button} <ArrowRight size={14} />
      </div>
    </div>
  );
}

/** Per-feature presentation for the bento grid: the icon, the grid cell span and the visual
 * (positional against `features` / `featureEyebrows`). Copy comes from the content modules. */
function featureVisuals(
  locale: SiteLocale,
): { icon: ReactNode; span: 1 | 2; visual?: ReactNode }[] {
  const { shotAlts } = landingContent(locale);
  return [
    {
      icon: <Kanban size={20} />,
      span: 2,
      visual: (
        <img
          className="lp2-shot lp2-shot--bottom"
          src={landingAsset(locale, '/landing/feat-entregas-dark.webp')}
          srcSet={featSrcSet(locale, 'feat-entregas-dark')}
          sizes={SHOT_SIZES_BOTTOM}
          width={1400}
          height={1095}
          alt={shotAlts.entregas}
          loading="lazy"
          decoding="async"
        />
      ),
    },
    { icon: <CalendarCheck size={20} />, span: 1 },
    { icon: <BarChart3 size={20} />, span: 2, visual: <MetricsVisual locale={locale} /> },
    {
      icon: <Link2 size={20} />,
      span: 1,
      visual: (
        <img
          className="lp2-shot lp2-shot--bleed"
          src={landingAsset(locale, '/landing/feat-hub-dark.webp')}
          srcSet={featSrcSet(locale, 'feat-hub-dark')}
          sizes={SHOT_SIZES_BLEED}
          width={1400}
          height={1050}
          alt={shotAlts.hub}
          loading="lazy"
          decoding="async"
        />
      ),
    },
    {
      icon: <Calendar size={20} />,
      span: 1,
      visual: (
        <img
          className="lp2-shot lp2-shot--bleed"
          src={landingAsset(locale, '/landing/feat-calendario-dark.webp')}
          srcSet={featSrcSet(locale, 'feat-calendario-dark')}
          sizes={SHOT_SIZES_BLEED}
          width={1400}
          height={1095}
          alt={shotAlts.calendario}
          loading="lazy"
          decoding="async"
        />
      ),
    },
    { icon: <MessageCircle size={20} />, span: 2, visual: <DmVisual locale={locale} /> },
  ];
}

/** Cards from this index on (Calendário, Automações) collapse behind "Ver todas as
 * funcionalidades" where the bento is one column (<=900px). */
const FIRST_EXTRA_FEATURE = 4;
const BENTO_ID = 'lp2-bento';

function Features({ locale }: { locale: SiteLocale }) {
  const { user, ready } = useLandingAuth();
  const content = landingContent(locale);
  const visuals = featureVisuals(locale);
  // Collapsed on the server and on the first client render. The collapse is CSS only: every card
  // stays in the DOM, so the `.reveal` observer attached at mount sees all six.
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="lp-pad" id="features">
      <div className="lp-container">
        <div className="lp2-section-head reveal">
          <h2>{twoTone(content.featuresTitle)}</h2>
          <p>{content.featuresSub}</p>
        </div>

        <div className="lp2-bento" id={BENTO_ID} data-expanded={expanded ? '' : undefined}>
          {content.features.map((feature, i) => {
            const { icon, span, visual } = visuals[i];
            const eyebrow = content.featureEyebrows[i];
            const classes = [
              'lp2-card',
              span === 2 ? 'lp2-card--wide' : '',
              visual ? 'lp2-card--visual' : '',
              i === 5 ? 'lp2-card--dm' : '',
              i >= FIRST_EXTRA_FEATURE ? 'lp2-card--extra' : '',
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
        {/* Siblings of the bento on purpose: CSS hides both once it has data-expanded. */}
        <button
          type="button"
          className="lp2-more"
          aria-expanded={expanded}
          aria-controls={BENTO_ID}
          onClick={() => setExpanded(true)}
        >
          {content.featuresMore.button} <ChevronDown size={18} />
        </button>
        <p className="lp2-more-note">{content.featuresMore.note}</p>

        <div className="lp2-features-cta">
          <p className="lp2-features-cta-title">{content.featuresMore.ctaTitle}</p>
          <p className="lp2-features-cta-note">
            <OfferNote note={content.hero.note} strong={content.hero.noteStrong} />
          </p>
          {!ready ? null : user ? (
            <a href="/dashboard" className="lp-btn lp-btn-cta lg">
              {content.hero.ctaSignedIn} <ArrowRight size={16} />
            </a>
          ) : (
            <a href={signupHref(locale)} className="lp-btn lp-btn-cta lg">
              {content.hero.ctaStart} <ArrowRight size={16} />
            </a>
          )}
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

function AgentSection({ locale }: { locale: SiteLocale }) {
  const { agente } = landingContent(locale);
  return (
    <section className="agent-wrap" id="agente">
      <div className="lp-container">
        <div className="lp2-section-head lp2-section-head--center reveal">
          <span className="lp2-eyebrow">{agente.eyebrow}</span>
          <h2>{agente.title}</h2>
          {agente.paragraphs.map((paragraph, i) => (
            <p key={i}>{withEmphasis(paragraph)}</p>
          ))}
        </div>
        <ul className="lp2-chips reveal">
          {agente.bullets.map((bullet, i) => (
            <li key={i} className="lp2-chip">
              {AGENT_CHIP_ICONS[i] ?? AGENT_CHIP_FALLBACK_ICON}
              <span>{withEmphasis(bullet)}</span>
            </li>
          ))}
        </ul>
        <div className="lp2-center reveal">
          <a href={signupHref(locale)} className="lp-btn lp-btn-primary lg">
            {agente.cta} <ArrowRight size={16} />
          </a>
        </div>
      </div>
    </section>
  );
}

function HowItWorks({ locale }: { locale: SiteLocale }) {
  const { how } = landingContent(locale);
  return (
    <section className="lp-pad lp-pad-alt" id="how">
      <div className="lp-container">
        <div className="lp2-section-head reveal">
          <h2>{twoTone(how.title)}</h2>
          <p>{how.sub}</p>
        </div>
        <div className="how-grid">
          {how.steps.map((s, i) => (
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

function CtaFinal({ locale }: { locale: SiteLocale }) {
  const { user, ready } = useLandingAuth();
  const { finalCta, hero } = landingContent(locale);

  return (
    <section className="cta-final-wrap">
      <div className="lp-container">
        <div className="cta-final-card reveal">
          {user ? (
            <>
              <h2>{finalCta.signedInTitle}</h2>
              <p>{finalCta.signedInBody}</p>
            </>
          ) : (
            <>
              <h2>
                {finalCta.titleBefore}
                <em>{finalCta.titleEm}</em>
              </h2>
              <p>{finalCta.body}</p>
            </>
          )}
          <div className="lp2-cta-row">
            {!ready ? null : user ? (
              <a href="/dashboard" className="lp-btn lp-btn-cta lg">
                {hero.ctaSignedIn} <ArrowRight size={16} />
              </a>
            ) : (
              <>
                <a href={signupHref(locale)} className="lp-btn lp-btn-cta lg">
                  {hero.ctaStart} <ArrowRight size={16} />
                </a>
                <a href="/login" className="lp-btn lp-btn-outline lg">
                  {finalCta.signIn} <ChevronRight size={16} />
                </a>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
