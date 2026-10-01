import { useSyncExternalStore, type CSSProperties } from 'react';
import { formatEtapaDeadlineDay } from '../etapaPrazo';

/** O que a pill de prazo dos cards mostra: o relativo ("2d atrasado") ou a
 *  data de vencimento ("Venceu 30 set"). Preferência única para todos os
 *  cards, persistida no navegador. */
export type DeadlineDisplayMode = 'relativo' | 'data';

const STORAGE_KEY = 'entregas_deadline_display';
const listeners = new Set<() => void>();

function readMode(): DeadlineDisplayMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'data' ? 'data' : 'relativo';
  } catch {
    return 'relativo';
  }
}

let currentMode: DeadlineDisplayMode = readMode();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function setDeadlineDisplayMode(mode: DeadlineDisplayMode) {
  currentMode = mode;
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Storage bloqueado: a troca vale só nesta sessão.
  }
  listeners.forEach((l) => l());
}

export function useDeadlineDisplayMode(): DeadlineDisplayMode {
  return useSyncExternalStore(
    subscribe,
    () => currentMode,
    () => 'relativo',
  );
}

interface DeadlinePillProps {
  /** Texto relativo já calculado pelo card ("1d atrasado", "3d restantes"). */
  relativeText: string;
  /** Data de vencimento; null = etapa sem prazo (a pill não alterna). */
  dueDate: Date | null;
  estourado: boolean;
  tipoPrazo: 'uteis' | 'corridos' | null | undefined;
  className: string;
  style?: CSSProperties;
  dataTour?: string;
}

/**
 * Pill de prazo dos cards do board. Clicar alterna, em todos os cards de uma
 * vez, entre o prazo relativo e a data de vencimento. O tipo de prazo
 * (úteis/corridos) só acompanha o modo relativo: numa data absoluta ele não
 * diz nada.
 */
export function DeadlinePill({
  relativeText,
  dueDate,
  estourado,
  tipoPrazo,
  className,
  style,
  dataTour,
}: DeadlinePillProps) {
  const mode = useDeadlineDisplayMode();
  const tipoLabel = tipoPrazo ? (tipoPrazo === 'uteis' ? 'úteis' : 'corridos') : null;

  if (!dueDate) {
    return (
      <span className={className} style={style} data-tour={dataTour}>
        {relativeText}
        {tipoLabel && <span className="board-card-prazo-type-inner">{tipoLabel}</span>}
      </span>
    );
  }

  const showDate = mode === 'data';
  const dateText = `${estourado ? 'Venceu' : 'Vence'} ${formatEtapaDeadlineDay(dueDate)}`;
  const fullDate = dueDate.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  return (
    <button
      type="button"
      className={`${className} board-card-deadline-toggle`}
      style={style}
      data-tour={dataTour}
      title={
        showDate
          ? `${relativeText}. Clique para ver em dias`
          : `${estourado ? 'Venceu' : 'Vence'} em ${fullDate}. Clique para ver a data`
      }
      onClick={(e) => {
        e.stopPropagation();
        setDeadlineDisplayMode(showDate ? 'relativo' : 'data');
      }}
    >
      {showDate ? (
        dateText
      ) : (
        <>
          {relativeText}
          {tipoLabel && <span className="board-card-prazo-type-inner">{tipoLabel}</span>}
        </>
      )}
    </button>
  );
}
