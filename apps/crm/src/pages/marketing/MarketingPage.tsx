import '../landing/landing.css';
import { LandingHeader, LandingFooter, useLandingChrome } from '../landing/LandingChrome';
import { FaqSection } from '../landing/FaqSection';
import { ArrowRight } from 'lucide-react';
import type { MarketingPageContent } from '@/content/paginas';
import { usePageMeta } from '@/lib/usePageMeta';

export default function MarketingPage({ page }: { page: MarketingPageContent }) {
  useLandingChrome();
  usePageMeta(`/${page.slug}`);
  return (
    <>
      <LandingHeader variant="subpage" />
      <main>
        <section className="lp-pad" id="top">
          <div className="lp-container">
            <div className="section-head">
              <span className="eyebrow-pill">{page.eyebrow}</span>
              <h1 className="hero-title">{page.h1}</h1>
              <p className="hero-sub">{page.sub}</p>
            </div>
          </div>
        </section>
        {page.sections.map((s) => (
          <section className="lp-pad" key={s.h2}>
            <div className="lp-container">
              <div className="section-head">
                <h2>{s.h2}</h2>
                {s.paragraphs.map((p) => (
                  <p key={p}>{p}</p>
                ))}
                {s.bullets?.length ? (
                  <ul>
                    {s.bullets.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          </section>
        ))}
        {page.faq.length > 0 && <FaqSection items={[...page.faq]} />}
        <section className="cta-final-wrap">
          <div className="lp-container">
            <div className="cta-final-card reveal">
              <img
                src="/icon.svg"
                style={{ height: 44, margin: '0 auto 22px', display: 'block' }}
                alt=""
              />
              <h2>{page.cta.title}</h2>
              <p>{page.cta.sub}</p>
              <a href="/login?tab=register" className="lp-btn lp-btn-primary lg">
                Criar conta grátis <ArrowRight size={16} />
              </a>
              <div
                style={{
                  marginTop: 18,
                  fontSize: '.8rem',
                  color: '#9ca3af',
                  fontFamily:
                    "-apple-system,'SF Pro Display','Plus Jakarta Sans',system-ui,sans-serif",
                  letterSpacing: '.08em',
                }}
              >
                Comece grátis · sem cartão de crédito
              </div>
            </div>
          </div>
        </section>
      </main>
      <LandingFooter />
    </>
  );
}
