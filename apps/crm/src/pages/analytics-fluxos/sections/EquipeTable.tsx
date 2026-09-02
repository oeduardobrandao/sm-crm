import { useMemo, type ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import type { EquipeAgg } from '@/services/workflowAnalytics';
import type { Membro } from '../../../store';
import {
  formatDataCurta,
  formatDiasDecimal,
  formatPontualidadeMembro,
  MIN_AVALIADAS,
  POUCOS_DADOS_TOOLTIP,
} from '../format';
import { SectionCard, SectionEmpty } from './SectionCard';

interface EquipeTableProps {
  equipe: EquipeAgg[];
  membrosById: Map<number, Membro>;
  /** `horizonte.workflow_events_since`: both event-derived columns below only
   *  exist from this date on, and the headers say so. */
  eventosDesde: string | null;
}

function PontualidadeCell({ membro }: { membro: EquipeAgg }) {
  const label = formatPontualidadeMembro(membro.no_prazo, membro.avaliadas);
  if (membro.avaliadas < MIN_AVALIADAS) {
    return (
      <Badge variant="neutral" data-tooltip={POUCOS_DADOS_TOOLTIP}>
        {label}
      </Badge>
    );
  }
  const pct = Math.round((membro.no_prazo / membro.avaliadas) * 100);
  const variant = pct >= 80 ? 'success' : pct >= 50 ? 'warning' : 'danger';
  return <Badge variant={variant}>{label}</Badge>;
}

function MembroCell({
  membro,
  size = 28,
}: {
  membro: Membro | undefined;
  size?: number;
}): ReactNode {
  const nome = membro?.nome ?? 'Membro removido';
  return (
    <>
      {membro?.avatar_url && (
        <img
          src={membro.avatar_url}
          alt=""
          loading="lazy"
          decoding="async"
          style={{
            width: size,
            height: size,
            borderRadius: '50%',
            objectFit: 'cover',
            marginRight: '0.5rem',
            verticalAlign: 'middle',
          }}
        />
      )}
      {nome}
    </>
  );
}

export function EquipeTable({ equipe, membrosById, eventosDesde }: EquipeTableProps) {
  const ordenada = useMemo(() => [...equipe].sort((a, b) => b.concluidas - a.concluidas), [equipe]);
  const desde = formatDataCurta(eventosDesde);
  // Short on purpose, and repeated in the caption: the table sits in an
  // `overflow-x: auto` wrapper, which clips absolutely-positioned tooltips on
  // BOTH axes. The caption is outside that wrapper and always readable.
  const retrabalhoTooltip = desde
    ? `Devoluções desde ${desde}`
    : 'Nenhuma devolução registrada ainda';
  const atividadeTooltip = desde ? `Eventos desde ${desde}` : 'Nenhuma atividade registrada ainda';
  const caption = desde
    ? `sem 100% falso: pouca amostra vira Poucos dados · retrabalho e atividade desde ${desde}`
    : 'sem 100% falso: pouca amostra vira Poucos dados';

  return (
    <SectionCard title="Desempenho da equipe" caption={caption}>
      {ordenada.length === 0 ? (
        <SectionEmpty>Nenhuma etapa concluída com responsável no período.</SectionEmpty>
      ) : (
        <>
          <div className="fluxos-team-desktop">
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Membro</th>
                    <th>Concluídas</th>
                    <th>Tempo médio</th>
                    <th>Pontualidade</th>
                    <th data-tooltip={retrabalhoTooltip}>Retrabalho</th>
                    <th data-tooltip={atividadeTooltip}>Atividade</th>
                  </tr>
                </thead>
                <tbody>
                  {ordenada.map((linha) => (
                    <tr key={linha.membro_id}>
                      <td data-label="Membro">
                        <MembroCell membro={membrosById.get(linha.membro_id)} />
                      </td>
                      <td data-label="Concluídas">{linha.concluidas}</td>
                      <td data-label="Tempo médio">{formatDiasDecimal(linha.media_dias)}</td>
                      <td data-label="Pontualidade">
                        <PontualidadeCell membro={linha} />
                      </td>
                      {/* Both are counts, not percentages: the RPC COALESCEs
                          them to 0, so a zero here really is "nothing recorded
                          for this member", never a missing value. */}
                      <td data-label="Retrabalho" style={{ color: 'var(--text-muted)' }}>
                        {linha.retrabalho}
                      </td>
                      <td data-label="Atividade" style={{ color: 'var(--text-muted)' }}>
                        {linha.atividade} eventos
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="fluxos-team-mobile">
            {ordenada.map((linha) => (
              <div key={linha.membro_id} className="card" style={{ padding: '0.875rem' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    marginBottom: '0.5rem',
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                    <MembroCell membro={membrosById.get(linha.membro_id)} size={32} />
                  </span>
                  <span style={{ marginLeft: 'auto' }}>
                    <PontualidadeCell membro={linha} />
                  </span>
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
                    <strong style={{ color: 'var(--text-main)' }}>{linha.concluidas}</strong>{' '}
                    concluídas
                  </span>
                  <span>
                    <strong style={{ color: 'var(--text-main)' }}>
                      {formatDiasDecimal(linha.media_dias)}
                    </strong>{' '}
                    média
                  </span>
                  <span>
                    <strong style={{ color: 'var(--text-main)' }}>{linha.retrabalho}</strong>{' '}
                    devoluções
                  </span>
                  <span>
                    <strong style={{ color: 'var(--text-main)' }}>{linha.atividade}</strong> eventos
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </SectionCard>
  );
}
