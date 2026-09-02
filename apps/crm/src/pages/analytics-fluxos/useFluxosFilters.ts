import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Page state for Analytics de Fluxos, kept in the URL so a filtered view is
 * shareable and survives a reload. Defaults are omitted from the query string
 * (same rule as `entregas/viewQuery.ts`), so the untouched page has a clean URL.
 */

export type Periodo = '7d' | '30d' | '90d' | 'tudo';

export const PERIODO_DEFAULT: Periodo = '30d';

export const PERIODOS: { value: Periodo; label: string }[] = [
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: 'tudo', label: 'Tudo' },
];

const PERIODO_DIAS: Record<Exclude<Periodo, 'tudo'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

/** Floor for the "Tudo" window. Predates any workspace in the product. */
const INICIO_DOS_TEMPOS = () => new Date(2020, 0, 1);

export interface FluxosFilters {
  periodo: Periodo;
  clienteId: number | null;
  templateId: number | null;
  /** Start of the window the RPC aggregates over (conclusion date). */
  from: Date;
  to: Date;
  /** True while a cliente or template narrows the data. The periodo does not
   *  count: it is always applied, so it can never mean "you filtered this out". */
  hasFilters: boolean;
  setPeriodo: (periodo: Periodo) => void;
  setClienteId: (id: number | null) => void;
  setTemplateId: (id: number | null) => void;
}

function parsePeriodo(raw: string | null): Periodo {
  const match = PERIODOS.find((p) => p.value === raw);
  return match ? match.value : PERIODO_DEFAULT;
}

function parseId(raw: string | null): number | null {
  if (raw === null) return null;
  const n = parseInt(raw, 10);
  return isNaN(n) ? null : n;
}

export function useFluxosFilters(): FluxosFilters {
  const [searchParams, setSearchParams] = useSearchParams();

  const periodo = parsePeriodo(searchParams.get('periodo'));
  const clienteId = parseId(searchParams.get('cliente'));
  const templateId = parseId(searchParams.get('template'));

  // `new Date()` straight in the render body would hand `useQuery` a fresh
  // queryFn closure (and a moving window) on every single render. Anchoring it
  // to the calendar day keeps the identity stable while the tab is in use, and
  // still re-anchors a dashboard someone left open overnight.
  const diaAtual = new Date().toDateString();
  const { from, to } = useMemo(() => {
    const now = new Date();
    if (periodo === 'tudo') return { from: INICIO_DOS_TEMPOS(), to: now };
    const start = new Date(now.getTime() - PERIODO_DIAS[periodo] * 86400000);
    return { from: start, to: now };
    // diaAtual is the re-anchor trigger, not a value the window reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodo, diaAtual]);

  const patch = useCallback(
    (key: string, value: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value === null) next.delete(key);
          else next.set(key, value);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setPeriodo = useCallback(
    (value: Periodo) => patch('periodo', value === PERIODO_DEFAULT ? null : value),
    [patch],
  );
  const setClienteId = useCallback(
    (id: number | null) => patch('cliente', id === null ? null : String(id)),
    [patch],
  );
  const setTemplateId = useCallback(
    (id: number | null) => patch('template', id === null ? null : String(id)),
    [patch],
  );

  return {
    periodo,
    clienteId,
    templateId,
    from,
    to,
    hasFilters: clienteId !== null || templateId !== null,
    setPeriodo,
    setClienteId,
    setTemplateId,
  };
}
