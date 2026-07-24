import '../landing/landing.css';
import { LandingHeader, LandingFooter, useLandingChrome } from '../landing/LandingChrome';
import { PricingSection } from '../landing/PricingSection';
import { FaqSection } from '../landing/FaqSection';
import { PRECOS } from '@/content/precos.content';
import { usePageMeta } from '@/lib/usePageMeta';

export default function PrecosPage() {
  useLandingChrome();
  usePageMeta('/precos');
  return (
    <>
      <LandingHeader variant="subpage" />
      <main>
        <section className="lp-pad" id="top">
          <div className="lp-container">
            <div className="section-head">
              <h1 className="hero-title">{PRECOS.h1}</h1>
              <p className="hero-sub">{PRECOS.sub}</p>
            </div>
          </div>
        </section>
        <PricingSection />
        <FaqSection items={[...PRECOS.faq]} />
      </main>
      <LandingFooter />
    </>
  );
}
