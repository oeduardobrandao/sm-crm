import '../landing/landing-styles';
import { LandingHeader, LandingFooter, useLandingChrome } from '../landing/LandingChrome';
import { PricingSection } from '../landing/PricingSection';
import { FaqSection } from '../landing/FaqSection';
import { localizedPath, precosContent, type SiteLocale } from '@/content/locale';
import { usePageMeta } from '@/lib/usePageMeta';

export default function PrecosPage({ locale = 'pt' }: { locale?: SiteLocale }) {
  const PRECOS = precosContent(locale);
  useLandingChrome();
  usePageMeta(localizedPath(locale, 'pricing'));
  return (
    <>
      <LandingHeader variant="subpage" locale={locale} />
      <main id="main-content" tabIndex={-1}>
        <section className="lp-pad" id="top">
          <div className="lp-container">
            <div className="section-head">
              <h1 className="hero-title">{PRECOS.h1}</h1>
              <p className="hero-sub">{PRECOS.sub}</p>
            </div>
          </div>
        </section>
        <PricingSection locale={locale} />
        <FaqSection items={[...PRECOS.faq]} locale={locale} />
      </main>
      <LandingFooter locale={locale} />
    </>
  );
}
