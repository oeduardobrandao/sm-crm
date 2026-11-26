import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { landingContent, type SiteLocale } from '@/content/locale';

export function FaqSection({
  items,
  locale = 'pt',
}: {
  items: Array<{ q: string; a: string }>;
  locale?: SiteLocale;
}) {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <section className="lp-pad lp-pad-alt" id="faq">
      <div className="lp-container">
        <div className="section-head reveal">
          <h2>{landingContent(locale).faqTitle}</h2>
        </div>
        <div className="faqs">
          {items.map((item, i) => (
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
