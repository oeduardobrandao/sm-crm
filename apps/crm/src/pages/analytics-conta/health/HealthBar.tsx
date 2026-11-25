import type { VerdictTone } from '@/lib/ig-account-health';

interface HealthBarProps {
  pct: number;
  tone: VerdictTone;
  size?: 'lg' | 'sm';
  /** Prefixa "cerca de " no rótulo acessível (referência de mercado). */
  approx?: boolean;
}

/** Barra 0..100 com marca na mediana (50), preenchimento até o percentil e marcador redondo. */
export function HealthBar({ pct, tone, size = 'lg', approx = false }: HealthBarProps) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div
      role="img"
      aria-label={`À frente de ${approx ? 'cerca de ' : ''}${clamped}% das contas do seu tamanho`}
      className={`ig-health-bar ig-health-bar--${size} ig-health-tone-${tone}`}
    >
      <span className="ig-health-bar__fill" style={{ width: `${clamped}%` }} />
      <span className="ig-health-bar__tick" />
      <span className="ig-health-bar__dot" style={{ left: `${clamped}%` }} />
    </div>
  );
}
