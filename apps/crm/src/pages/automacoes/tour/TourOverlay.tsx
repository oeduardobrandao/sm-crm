import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { TourStep } from './tourSteps';

/** Quanto tempo re-tentar achar a âncora antes do fail-safe encerrar o tour
 * (o dialog pode ainda estar montando quando o passo 2 chega). */
const ANCHOR_RETRY_MS = 1000;
const CARD_WIDTH = 290;
const GAP = 12;
/** Abaixo disso o card vira folha no rodapé (mockup aprovado). */
const SHEET_BREAKPOINT = 640;

export interface TourOverlayProps {
  step: TourStep;
  index: number; // 0-based
  total: number;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  onFinish: () => void;
  /** Só usado no passo 1 (índice 0). */
  onCta?: () => void;
}

interface Layout {
  spot: { top: number; left: number; width: number; height: number };
  /** null = folha no rodapé (viewport estreito). */
  card: { top: number; left: number } | null;
}

export default function TourOverlay({
  step,
  index,
  total,
  onNext,
  onBack,
  onSkip,
  onFinish,
  onCta,
}: TourOverlayProps) {
  const { t } = useTranslation('automations');
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  // Ref para o fail-safe não reiniciar o loop de rAF quando o pai recria o
  // callback a cada render.
  const onSkipRef = useRef(onSkip);
  onSkipRef.current = onSkip;

  const measure = useCallback((): boolean => {
    const anchor = document.querySelector<HTMLElement>(`[data-tour="${step.anchor}"]`);
    if (!anchor) return false;
    const rect = anchor.getBoundingClientRect();
    // Sistema de coordenadas (ver spec): página = viewport; dialog = local ao
    // wrapper com scroll interno do DialogContent (`[data-dialog-scroll]`,
    // ver dialog.tsx). Precisa ser ESSE wrapper -- não o Radix Content mais
    // externo -- porque ele é o containing block real do overlay
    // `position: absolute`: mesmo o Content tendo `transform` (containing
    // block "formal" de um `position: fixed` descendente), o navegador ainda
    // desloca visualmente um `position: absolute` junto com o scroll do
    // ancestral rolável mais próximo quando esse ancestral é `position:
    // static` -- o que dobraria o delta de scroll se o overlay não estivesse
    // no MESMO containing block que a âncora.
    let originTop = 0;
    let originLeft = 0;
    let boundW = window.innerWidth;
    let boundH = window.innerHeight;
    if (step.surface === 'dialog') {
      const content = rootRef.current?.closest<HTMLElement>('[data-dialog-scroll]');
      if (!content) return false;
      const cRect = content.getBoundingClientRect();
      // O containing block do overlay É o próprio wrapper que rola, então um
      // `top`/`left` absoluto nele é interpretado como coordenada de
      // CONTEÚDO (como se scrollTop/scrollLeft fossem 0), não como posição
      // relativa ao trecho atualmente visível. `scrollIntoView()` (chamado
      // antes desta medição, no mesmo tick, ver loop `tick()` abaixo) já pode
      // ter deixado o wrapper com scroll diferente de zero -- sem subtrair
      // esse scroll do origin aqui, o spot nasce deslocado por exatamente
      // esse valor na primeira medição de cada passo.
      originTop = cRect.top - content.scrollTop;
      originLeft = cRect.left - content.scrollLeft;
      // boundW/boundH usam o tamanho VISÍVEL do wrapper (não o scroll total)
      // -- isso decide se o card cabe abaixo do spot e faz o clamp horizontal.
      boundW = cRect.width;
      boundH = cRect.height;
    }
    const spot = {
      top: rect.top - originTop,
      left: rect.left - originLeft,
      width: rect.width,
      height: rect.height,
    };
    let card: Layout['card'] = null;
    if (window.innerWidth >= SHEET_BREAKPOINT) {
      const cardH = cardRef.current?.offsetHeight ?? 180;
      const below = spot.top + spot.height + GAP;
      const top = below + cardH > boundH ? Math.max(GAP, spot.top - cardH - GAP) : below;
      const left = Math.min(Math.max(GAP, spot.left), Math.max(GAP, boundW - CARD_WIDTH - GAP));
      card = { top, left };
    }
    setLayout({ spot, card });
    return true;
  }, [step]);

  // Localiza a âncora (com retry: o dialog pode estar montando), rola até ela
  // e mede. Se a âncora nunca aparece, encerra o tour em vez de deixar um
  // card órfão (fail-safe do spec).
  useLayoutEffect(() => {
    setLayout(null);
    let raf = 0;
    let scrolled = false;
    const deadline = performance.now() + ANCHOR_RETRY_MS;
    const tick = () => {
      const anchor = document.querySelector<HTMLElement>(`[data-tour="${step.anchor}"]`);
      if (anchor && !scrolled) {
        scrolled = true;
        anchor.scrollIntoView?.({ block: 'center' });
      }
      if (measure()) return;
      if (performance.now() > deadline) {
        onSkipRef.current();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [step, measure]);

  // O listener de scroll só é necessário (e correto) para o passo de página:
  // as coordenadas ali são relativas ao viewport (`position: fixed`,
  // originTop/Left = 0), então um scroll da PRÓPRIA página pode mover o botão
  // real. Para o passo de dialog, o containing block do overlay É o wrapper
  // que rola (`[data-dialog-scroll]`, ver dialog.tsx e measure() acima), e o
  // navegador já acompanha esse scroll sozinho via CSS -- recalcular aqui
  // aplicaria o deslocamento uma SEGUNDA vez, reintroduzindo o desalinhamento
  // que a correção do containing block já eliminou.
  useEffect(() => {
    const handler = () => void measure();
    window.addEventListener('resize', handler);
    if (step.surface === 'page') {
      document.addEventListener('scroll', handler, true);
    }
    return () => {
      window.removeEventListener('resize', handler);
      if (step.surface === 'page') document.removeEventListener('scroll', handler, true);
    };
  }, [measure, step.surface]);

  const isFirst = index === 0;
  const isLast = index === total - 1;

  return (
    // O root existe mesmo sem layout: o measure de passos de dialog precisa
    // dele montado para achar o Content via closest().
    <div
      ref={rootRef}
      data-testid="tour-overlay"
      style={{
        position: step.surface === 'dialog' ? 'absolute' : 'fixed',
        inset: 0,
        zIndex: step.surface === 'page' ? 8990 : 20,
        pointerEvents: 'none',
      }}
    >
      {layout && (
        <>
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: layout.spot.top,
              left: layout.spot.left,
              width: layout.spot.width,
              height: layout.spot.height,
              borderRadius: 10,
              pointerEvents: 'none',
              boxShadow:
                '0 0 0 4px var(--card-bg), 0 0 0 6px var(--primary-color), 0 0 0 9999px rgba(10, 12, 15, 0.6)',
            }}
          />
          <div
            ref={cardRef}
            data-testid="tour-card"
            role="dialog"
            aria-label={t(step.titleKey)}
            style={{
              position: 'absolute',
              pointerEvents: 'auto',
              background: 'var(--card-bg)',
              border: '1px solid var(--border-color)',
              borderRadius: layout.card ? 12 : '12px 12px 0 0',
              padding: '0.9rem 1rem 0.8rem',
              boxShadow: '0 12px 32px rgba(10, 12, 15, 0.25)',
              ...(layout.card
                ? { top: layout.card.top, left: layout.card.left, width: CARD_WIDTH }
                : {
                    // Modo folha (mobile): position:absolute herda o wrapper
                    // rolável [data-dialog-scroll] como containing block, e
                    // bottom:0 vira coordenada de CONTEÚDO (fim do scroll),
                    // não do fundo visível do dialog -- a folha some ao
                    // rolar. position:fixed escapa desse scroll porque o
                    // DialogPrimitive.Content (que tem transform) vira o
                    // containing block de descendentes fixed, ancorando a
                    // folha ao próprio dialog em vez do viewport inteiro. Só
                    // para 'dialog': a chave 'position' só entra no objeto
                    // quando precisa mudar -- incluí-la com valor undefined
                    // para 'page' sobrescreveria (e apagaria) o
                    // position:'absolute' do style base acima, já que numa
                    // mesma literal de objeto a última ocorrência de uma
                    // chave vence mesmo quando o valor é undefined.
                    ...(step.surface === 'dialog' ? { position: 'fixed' as const } : {}),
                    bottom: 0,
                    left: 0,
                    right: 0,
                  }),
            }}
          >
            <div
              className="flex items-baseline justify-between"
              style={{ marginBottom: '0.25rem' }}
            >
              <span
                style={{
                  fontSize: '0.65rem',
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  letterSpacing: '0.04em',
                }}
              >
                {t('tour.counter', { current: index + 1, total })}
              </span>
              <button
                type="button"
                className="text-xs underline"
                style={{ color: 'var(--text-muted)' }}
                onClick={onSkip}
              >
                {t('tour.skip')}
              </button>
            </div>
            <p style={{ fontWeight: 700, fontSize: '0.85rem', margin: '0 0 0.25rem' }}>
              {t(step.titleKey)}
            </p>
            <p
              style={{
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
                margin: '0 0 0.7rem',
                lineHeight: 1.45,
              }}
            >
              {t(step.textKey)}
            </p>
            <div className="flex items-center justify-between">
              <span className="flex" style={{ gap: 4 }} aria-hidden="true">
                {Array.from({ length: total }, (_, i) => (
                  <span
                    key={i}
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: '50%',
                      background: i === index ? 'var(--primary-color)' : 'var(--border-color)',
                    }}
                  />
                ))}
              </span>
              <span className="flex items-center" style={{ gap: '0.4rem' }}>
                {index >= 2 && (
                  <Button type="button" variant="ghost" size="sm" onClick={onBack}>
                    {t('tour.back')}
                  </Button>
                )}
                {isFirst ? (
                  <Button type="button" size="sm" onClick={onCta}>
                    {t(step.ctaKey ?? 'tour.next')}
                  </Button>
                ) : isLast ? (
                  <Button type="button" size="sm" onClick={onFinish}>
                    {t('tour.finish')}
                  </Button>
                ) : (
                  <Button type="button" size="sm" onClick={onNext}>
                    {t('tour.next')}
                  </Button>
                )}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
