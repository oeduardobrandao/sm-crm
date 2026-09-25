// Detecta quando o cabeçalho sticky do editor descolou do topo (o canvas rolou),
// para ele virar o cartão flutuante no estilo do menu do Hub (HubMobileNav).
// Sentinela + IntersectionObserver, mesmo padrão do Hub: não depende de qual
// elemento rola. jsdom não tem IntersectionObserver: lá fica sempre "não rolado".
import { useEffect, useRef, useState } from 'react';

export function useStuckHeader() {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { sentinelRef, stuck };
}
