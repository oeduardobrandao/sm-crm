import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

export function FaqSection({ items }: { items: Array<{ q: string; a: string }> }) {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <section className="lp-pad lp-pad-alt" id="faq">
      <div className="lp-container">
        <div className="section-head reveal">
          <h2>Perguntas frequentes</h2>
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
