import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import type { EtapaAgg } from '@/services/workflowAnalytics';
import { formatDiasDecimal, SEM_DADOS } from '../format';
import { SectionCard, SectionEmpty } from './SectionCard';

/** Rows shown before the "Mostrar todas as etapas" toggle. */
const TOP_N = 10;

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

export function GargalosTable({ etapas }: { etapas: EtapaAgg[] }) {
  const [showAll, setShowAll] = useState(false);

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
      caption="tempo médio real de cada etapa concluída no período"
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
