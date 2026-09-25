// Detecta quando o cabeçalho sticky do editor descolou do topo (o canvas rolou),
// para ele virar o cartão flutuante no estilo do menu do Hub (HubMobileNav).
// Sentinela + IntersectionObserver, mesmo padrão do Hub. jsdom não tem
// IntersectionObserver: lá fica sempre "não rolado".
//
// O sticky prende na borda de PADDING do scroller (.main-content, cujo padding
// muda por breakpoint) deslocada pelo `top` do cabeçalho. Sem compensar isso a
// sentinela só sairia na borda do scroller, dezenas de px depois de o
// cabeçalho já estar preso: um trecho com o canvas rolando por baixo do
// cabeçalho ainda transparente. Por isso o observer usa o scroller como root e
// encolhe o topo dele até a linha exata em que o cabeçalho prende.
import { useEffect, useRef, useState } from 'react';

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(p).overflowY)) return p;
  }
  return null;
}

export function useStuckHeader() {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    let io: IntersectionObserver | null = null;
    const observe = () => {
      io?.disconnect();
      const root = scrollParent(el);
      const header = headerRef.current;
      const pad = root ? parseFloat(getComputedStyle(root).paddingTop) || 0 : 0;
      const top = header ? parseFloat(getComputedStyle(header).top) || 0 : 0;
      const inset = Math.max(0, pad + top);
      io = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting), {
        root,
        rootMargin: `-${inset}px 0px 0px 0px`,
      });
      io.observe(el);
    };
    observe();
    // Padding do scroller e o próprio sticky mudam por breakpoint.
    window.addEventListener('resize', observe);
    return () => {
      window.removeEventListener('resize', observe);
      io?.disconnect();
    };
  }, []);
  return { sentinelRef, headerRef, stuck };
}
