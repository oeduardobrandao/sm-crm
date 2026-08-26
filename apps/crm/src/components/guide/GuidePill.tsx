import { Compass } from 'lucide-react';
import { useGuide, type GuideOpenSource } from './GuideContext';

/** Reentrada fixa do guia. Visibilidade responsiva 100% via CSS (.guide-pill):
 *  display none por padrão, visível só >=1101px. jsdom não avalia media
 *  queries: a visibilidade responsiva se verifica no browser, não em teste. */
export function GuidePill() {
  const g = useGuide();
  if (!g || !g.showEntryPoint) return null;
  return (
    <button type="button" className="guide-pill" onClick={() => g.open('pill')}>
      <Compass className="h-4 w-4" aria-hidden="true" />
      <span style={{ fontWeight: 600 }}>Guia</span>
      <span style={{ color: 'var(--text-muted)' }}>
        {g.totals.done} de {g.totals.total}
      </span>
      <span className="guide-pill-dot" aria-hidden="true" />
    </button>
  );
}

/** Reentrada em navegação: sidebar em modo drawer (tablet) e sheet Mais do
 *  MobileNav (telefone). */
export function GuideNavItem({
  source,
  className,
}: {
  source: Extract<GuideOpenSource, 'sidebar' | 'mobile_nav'>;
  className?: string;
}) {
  const g = useGuide();
  if (!g || !g.showEntryPoint) return null;
  return (
    <button type="button" className={className} onClick={() => g.open(source)}>
      <Compass size={18} aria-hidden="true" />
      <span>
        Guia de primeiros passos · {g.totals.done} de {g.totals.total}
      </span>
      <span className="guide-pill-dot" aria-hidden="true" />
    </button>
  );
}
