import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import type { EtapaAgg } from '@/services/workflowAnalytics';
import { formatDiasDecimal, formatDataCurta, SEM_DADOS } from '../format';
import { SectionCard, SectionEmpty } from './SectionCard';

/** Rows shown before the "Mostrar todas as etapas" toggle. */
const TOP_N = 10;

/**
 * What a null retrabalho prints. Not "0%": null means the etapa recorded no
 * conclusion in the window at all, so there is no denominator — a printed zero
 * would read as "never sent back", which is a claim the data cannot make.
 */
const SEM_BASE_RETRABALHO = '·';

type AtrasoVariant = 'success' | 'warning' | 'danger';

function atrasoVariant(pct: number): AtrasoVariant {
  if (pct <= 20) return 'success';
  if (pct <= 50) return 'warning';
  return 'danger';
}

function AtrasoBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <Badge variant="neutral">{SEM_DADOS}</Badge>;
  return <Badge variant={atrasoVariant(pct)}>{Math.round(pct)}%</Badge>;
}

/** Horizontal bar sized against the slowest etapa, so the eye ranks the rows
 *  before it reads a single number. */
function TempoBar({ dias, max }: { dias: number | null; max: number }) {
  const pct = dias === null || max <= 0 ? 0 : Math.max(2, Math.round((dias / max) * 100));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <div
        aria-hidden
        style={{
          flex: 1,
          minWidth: 48,
          height: 6,
          borderRadius: 3,
          background: 'var(--surface-2)',
          overflow: 'hidden',
        }}
      >
        <div style={{ width: `${pct}%`, height: 6, borderRadius: 3, background: 'var(--teal)' }} />
      </div>
      <span style={{ whiteSpace: 'nowrap' }}>{formatDiasDecimal(dias)}</span>
    </div>
  );
}

interface GargalosTableProps {
  etapas: EtapaAgg[];
  /** `horizonte.workflow_events_since`: the retrabalho column is blind to
   *  anything that happened before the event log existed, and the header says
   *  so instead of letting an old etapa look conflict-free. */
  eventosDesde: string | null;
}

export function GargalosTable({ etapas, eventosDesde }: GargalosTableProps) {
  const [showAll, setShowAll] = useState(false);
  const desde = formatDataCurta(eventosDesde);
  // Kept short on purpose: the table lives in an `overflow-x: auto` wrapper,
  // and a wrapper that scrolls on one axis clips the other too, so a long
  // nowrap tooltip escaping a `th` would be cut off. The caption below carries
  // the same fact outside the scroll container, where it always shows.
  const retrabalhoTooltip = desde
    ? `Devoluções desde ${desde}`
    : 'Nenhuma devolução registrada ainda';
  const caption = desde
    ? `tempo médio real de cada etapa concluída no período · retrabalho registrado desde ${desde}`
    : 'tempo médio real de cada etapa concluída no período';

  const ordenadas = useMemo(
    () => [...etapas].sort((a, b) => (b.media_dias ?? -1) - (a.media_dias ?? -1)),
    [etapas],
  );
  const visiveis = showAll ? ordenadas : ordenadas.slice(0, TOP_N);
  const max = ordenadas[0]?.media_dias ?? 0;
  const escondidas = ordenadas.length - visiveis.length;

  return (
    <SectionCard
      title="Gargalos por etapa"
      caption={caption}
      footer={
        ordenadas.length > TOP_N ? (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            style={{
              marginTop: '0.75rem',
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              fontSize: '0.75rem',
              color: 'var(--teal)',
            }}
          >
            {showAll ? 'Mostrar menos' : `Mostrar todas as etapas (${escondidas} ocultas)`}
          </button>
        ) : null
      }
    >
      {ordenadas.length === 0 ? (
        <SectionEmpty>Nenhuma etapa concluída no período.</SectionEmpty>
      ) : (
        <>
          <div className="fluxos-bottleneck-desktop">
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Etapa</th>
                    <th style={{ width: '38%' }}>Tempo médio</th>
                    <th>Atraso</th>
                    <th data-tooltip={retrabalhoTooltip}>Retrabalho</th>
                    <th>Amostras</th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((etapa) => (
                    <tr key={etapa.nome}>
                      <td data-label="Etapa">{etapa.nome}</td>
                      <td data-label="Tempo médio">
                        <TempoBar dias={etapa.media_dias} max={max} />
                      </td>
                      <td data-label="Atraso">
                        <AtrasoBadge pct={etapa.atraso_pct} />
                      </td>
                      <td data-label="Retrabalho" style={{ color: 'var(--text-muted)' }}>
                        {etapa.retrabalho_pct === null
                          ? SEM_BASE_RETRABALHO
                          : `${Math.round(etapa.retrabalho_pct)}%`}
                      </td>
                      <td data-label="Amostras">{etapa.amostras}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="fluxos-bottleneck-mobile">
            {visiveis.map((etapa) => (
              <div key={etapa.nome} className="card" style={{ padding: '0.875rem' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '0.5rem',
                    marginBottom: '0.35rem',
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{etapa.nome}</span>
                  <AtrasoBadge pct={etapa.atraso_pct} />
                </div>
                <div
                  style={{
                    display: 'flex',
                    gap: '1rem',
                    fontSize: '0.8rem',
                    color: 'var(--text-muted)',
                  }}
                >
                  <span>
                    Tempo médio:{' '}
                    <strong style={{ color: 'var(--text-main)' }}>
                      {formatDiasDecimal(etapa.media_dias)}
                    </strong>
                  </span>
                  {etapa.retrabalho_pct !== null && (
                    <span>{Math.round(etapa.retrabalho_pct)}% retrabalho</span>
                  )}
                  <span>{etapa.amostras} amostras</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </SectionCard>
  );
}
