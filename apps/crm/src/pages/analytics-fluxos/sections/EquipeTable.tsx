import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import i18n from 'i18next';
import { PessoaAvatar } from '@/components/PessoaAvatar';
import { Badge } from '@/components/ui/badge';
import type { EquipeAgg } from '@/services/workflowAnalytics';
import type { Membro } from '../../../store';
import {
  formatDataCurta,
  formatDiasDecimal,
  formatPontualidadeMembro,
  MIN_AVALIADAS,
  poucosDadosTooltip,
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
      <Badge variant="neutral" data-tooltip={poucosDadosTooltip()}>
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
  const nome = membro?.nome ?? i18n.t('analyticsFlows:team.removedMember');
  // No photo, no avatar: this table has always been name-only for those rows.
  if (!membro?.avatar_url) return nome;
  return (
    <span className="inline-flex items-center gap-2 align-middle">
      <PessoaAvatar nome={nome} fotoUrl={membro.avatar_url} seed={membro.id} size={size} />
      {nome}
    </span>
  );
}

export function EquipeTable({ equipe, membrosById, eventosDesde }: EquipeTableProps) {
  const { t } = useTranslation('analyticsFlows');
  const ordenada = useMemo(() => [...equipe].sort((a, b) => b.concluidas - a.concluidas), [equipe]);
  const desde = formatDataCurta(eventosDesde);
  // Short on purpose, and repeated in the caption: the table sits in an
  // `overflow-x: auto` wrapper, which clips absolutely-positioned tooltips on
  // BOTH axes. The caption is outside that wrapper and always readable.
  const retrabalhoTooltip = desde
    ? t('team.reworkTooltip', { date: desde })
    : t('team.reworkTooltipNone');
  const atividadeTooltip = desde
    ? t('team.activityTooltip', { date: desde })
    : t('team.activityTooltipNone');
  const caption = desde ? t('team.caption', { date: desde }) : t('team.captionNoSince');

  return (
    <SectionCard title={t('team.title')} caption={caption}>
      {ordenada.length === 0 ? (
        <SectionEmpty>{t('team.empty')}</SectionEmpty>
      ) : (
        <>
          <div className="fluxos-team-desktop">
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('team.member')}</th>
                    <th>{t('team.done')}</th>
                    <th>{t('kpi.avgTime')}</th>
                    <th>{t('kpi.onTime')}</th>
                    <th data-tooltip={retrabalhoTooltip}>{t('kpi.rework')}</th>
                    <th data-tooltip={atividadeTooltip}>{t('team.activity')}</th>
                  </tr>
                </thead>
                <tbody>
                  {ordenada.map((linha) => (
                    <tr key={linha.membro_id}>
                      <td data-label={t('team.member')}>
                        <MembroCell membro={membrosById.get(linha.membro_id)} />
                      </td>
                      <td data-label={t('team.done')}>{linha.concluidas}</td>
                      <td data-label={t('kpi.avgTime')}>{formatDiasDecimal(linha.media_dias)}</td>
                      <td data-label={t('kpi.onTime')}>
                        <PontualidadeCell membro={linha} />
                      </td>
                      {/* Both are counts, not percentages: the RPC COALESCEs
                          them to 0, so a zero here really is "nothing recorded
                          for this member", never a missing value. */}
                      <td data-label={t('kpi.rework')} style={{ color: 'var(--text-muted)' }}>
                        {linha.retrabalho}
                      </td>
                      <td data-label={t('team.activity')} style={{ color: 'var(--text-muted)' }}>
                        {t('team.eventsCount', { count: linha.atividade })}
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
                    {t('team.doneLabel')}
                  </span>
                  <span>
                    <strong style={{ color: 'var(--text-main)' }}>
                      {formatDiasDecimal(linha.media_dias)}
                    </strong>{' '}
                    {t('team.avgLabel')}
                  </span>
                  <span>
                    <strong style={{ color: 'var(--text-main)' }}>{linha.retrabalho}</strong>{' '}
                    {t('team.returnsLabel')}
                  </span>
                  <span>
                    <strong style={{ color: 'var(--text-main)' }}>{linha.atividade}</strong>{' '}
                    {t('team.eventsLabel')}
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
