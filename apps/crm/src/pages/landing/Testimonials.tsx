import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Testimonial {
  quote: string;
  name: string;
  role: string;
  avatar: string;
}

export const TESTIMONIALS: readonly Testimonial[] = [
  {
    quote:
      'O Mesaas mudou completamente a forma como gerencio meus clientes. Antes eu vivia perdida em planilhas e grupos de WhatsApp. Agora tudo fica em um só lugar e consigo entregar com muito mais qualidade e no prazo.',
    name: 'Débora Kristin',
    role: 'DK Marketing Médico',
    avatar: '/landing/testimonial-debora.webp',
  },
  {
    quote:
      'Trabalhar com o Mesaas foi um divisor aqui na agência. Super visual, melhorou o fluxo e deixou meu serviço mais robusto.',
    name: 'Jennifer Araripe',
    role: 'Araripe MKT',
    avatar: '/landing/testimonial-jennifer.webp',
  },
  {
    quote:
      'Antes do Mesaas, meu fluxo era fragmentado e lento. Hoje cada cliente tem seu próprio portal, com métricas em tempo real. Transformou meus processos da água para o vinho.',
    name: 'Nikoly Thaiane',
    role: 'Síntese Criativa',
    avatar: '/landing/testimonial-nikoly.webp',
  },
  {
    quote:
      'Finalmente alguém criou um sistema que realmente reúne tudo que a gente precisa e por um preço compatível com agências pequenas.',
    name: 'Mônica Seolim',
    role: 'Comunicativa & Co',
    avatar: '/landing/testimonial-monica.webp',
  },
];

const AUTOPLAY_MS = 7000;
const SWIPE_MIN_PX = 48;

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

type SlidePosition = 'active' | 'prev' | 'next';

/** Slides leave toward the side they came from, so wrapping last -> first keeps moving forward. */
function slidePosition(slide: number, active: number, total: number): SlidePosition {
  const offset = (slide - active + total) % total;
  if (offset === 0) return 'active';
  return offset === total - 1 ? 'prev' : 'next';
}

export function Testimonials() {
  const total = TESTIMONIALS.length;
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [reducedMotion] = useState(prefersReducedMotion);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const paused = hovered || focused;

  const go = useCallback((to: number) => setIndex(((to % total) + total) % total), [total]);

  // Re-armed on every index change, so a manual click also restarts the countdown.
  useEffect(() => {
    if (paused || reducedMotion) return;
    const timer = window.setTimeout(() => setIndex((i) => (i + 1) % total), AUTOPLAY_MS);
    return () => window.clearTimeout(timer);
  }, [index, paused, reducedMotion, total]);

  function onPointerDown(e: PointerEvent) {
    // Mouse drags would fight text selection; the arrows and dots cover desktop.
    if (e.pointerType === 'mouse') return;
    swipeStart.current = { x: e.clientX, y: e.clientY };
  }

  function onPointerUp(e: PointerEvent) {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    go(dx < 0 ? index + 1 : index - 1);
  }

  return (
    <section
      className="quote-wrap"
      aria-roledescription="carousel"
      aria-labelledby="depoimentos-title"
    >
      <div className="lp-container">
        <div className="lp2-section-head lp2-section-head--center reveal">
          <h2 id="depoimentos-title">Veja o que estão falando sobre nós:</h2>
        </div>
      </div>
      <div
        className="quote-card reveal"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          swipeStart.current = null;
        }}
      >
        <div className="quote-slides" aria-live={paused ? 'polite' : 'off'}>
          {TESTIMONIALS.map((t, i) => (
            <figure
              key={t.name}
              className="quote-slide"
              data-pos={slidePosition(i, index, total)}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} de ${total}`}
              aria-hidden={i !== index}
            >
              <div className="quote-mark" aria-hidden="true">
                "
              </div>
              <blockquote>{t.quote}</blockquote>
              <cite>
                <div className="quote-avatar">
                  <img
                    src={t.avatar}
                    width={56}
                    height={56}
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                </div>
                <div className="quote-who">
                  <div className="n">{t.name}</div>
                  <div className="r">{t.role}</div>
                </div>
              </cite>
            </figure>
          ))}
        </div>

        <button
          type="button"
          className="quote-nav quote-nav--prev"
          aria-label="Depoimento anterior"
          onClick={() => go(index - 1)}
        >
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="quote-nav quote-nav--next"
          aria-label="Próximo depoimento"
          onClick={() => go(index + 1)}
        >
          <ChevronRight size={20} aria-hidden="true" />
        </button>

        <div className="quote-dots">
          {TESTIMONIALS.map((t, i) => (
            <button
              key={t.name}
              type="button"
              className="quote-dot"
              aria-label={`Ver depoimento de ${t.name}`}
              aria-current={i === index}
              onClick={() => go(i)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
