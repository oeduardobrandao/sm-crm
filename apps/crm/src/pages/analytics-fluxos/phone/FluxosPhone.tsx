import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, MoreHorizontal, Printer } from 'lucide-react';
import { PhonePageHeader } from '@/components/mobile/PhonePageHeader';
import { PhoneIconButton } from '@/components/mobile/LargeTitleHeader';
import { SegmentedControl } from '@/components/mobile/SegmentedControl';
import { ActionSheet } from '@/components/mobile/ActionSheet';
import { BarList } from '@/components/mobile/BarList';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import type { WorkflowAnalytics } from '@/services/workflowAnalytics';
import type { Cliente, Membro } from '../../../store';
import { PessoaAvatar } from '@/components/PessoaAvatar';
import { useClienteAvatars } from '@/hooks/useClienteAvatars';
import { Avatar, PickerChip, SectionHead } from '../../analytics/phone/shared';
import {
  formatDataCurta,
  formatDiasDecimal,
  formatHorasOuSemDados,
  formatPontualidadeMembro,
  semanaDeLabel,
  horizonteCaption,
  MIN_AVALIADAS,
  origemLabel,
  poucosDadosTooltip,
  semDados,
} from '../format';
import { getPeriodos, type Periodo } from '../useFluxosFilters';
import { KpiRow } from '../sections/KpiRow';
import { buildPontos } from '../sections/RitmoChart';
import {
  faixaLabel,
  LENTO_HORAS,
  SLOW_CLIENTS_TOP_N,
  temAtividadeAprovacao,
} from '../sections/AprovacaoSection';
import { GARGALOS_TOP_N } from '../sections/GargalosTable';
import { temOrigemParaMostrar } from '../sections/OrigemCard';

export interface FluxosPhoneProps {
  periodo: Periodo;
  onPeriodo: (p: Periodo) => void;
  clientes: Cliente[];
  clienteId: number | null;
  onClienteId: (id: number | null) => void;
  templates: { id?: number; nome: string }[];
  templateId: number | null;
  onTemplateId: (id: number | null) => void;
  /** Error, loading or empty-workspace state; replaces the sections when set. */
  status: ReactNode | null;
  data: WorkflowAnalytics | undefined;
  emptyFiltered: boolean;
  clientesById: Map<number, Cliente>;
  membrosById: Map<number, Membro>;
  canExport: boolean;
  onExport: () => void;
}

/** /analytics-fluxos below 768px. Numbers and filters come from the page. */
export function FluxosPhone({
  periodo,
  onPeriodo,
  clientes,
  clienteId,
  onClienteId,
  templates,
  templateId,
  onTemplateId,
  status,
  data,
  emptyFiltered,
  clientesById,
  membrosById,
  canExport,
  onExport,
}: FluxosPhoneProps) {
  const { t } = useTranslation('analyticsFlows');
  const { fotosDe } = useClienteAvatars(clientes);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);

  const clienteLabel =
    clienteId !== null
      ? (clientesById.get(clienteId)?.nome ?? t('page.unidentified'))
      : t('page.all');
  const templateLabel =
    templateId !== null
      ? (templates.find((tpl) => tpl.id === templateId)?.nome ?? t('page.unidentified'))
      : t('page.all');

  return (
    <div className="phone-kit phone-an">
      <PhonePageHeader
        title={t('page.titlePhone')}
        subtitle={t('page.hint')}
        actions={
          <PhoneIconButton
            ref={menuRef}
            label={t('page.moreActions')}
            aria-haspopup="dialog"
            onClick={() => setMenuOpen(true)}
          >
            <MoreHorizontal aria-hidden="true" />
          </PhoneIconButton>
        }
      >
        <div className="phone-an-period">
          <SegmentedControl<Periodo>
            aria-label={t('page.period')}
            options={getPeriodos()}
            value={periodo}
            onChange={onPeriodo}
          />
        </div>
      </PhonePageHeader>

      <div className="phone-an-chips">
        <PickerChip<number>
          label={t('page.client')}
          valueLabel={clienteLabel}
          options={clientes
            .filter((c) => c.id !== undefined)
            .map((c) => ({ value: c.id as number, label: c.nome }))}
          value={clienteId}
          onChange={onClienteId}
          emptyOption={{ label: t('page.clientAll') }}
          searchable={clientes.length > 8}
        />
        <PickerChip<number>
          label={t('page.template')}
          valueLabel={templateLabel}
          options={templates
            .filter((t) => t.id !== undefined)
            .map((t) => ({ value: t.id as number, label: t.nome }))}
          value={templateId}
          onChange={onTemplateId}
          emptyOption={{ label: t('page.templateAll') }}
          searchable={templates.length > 8}
        />
      </div>

      {status ??
        (data && (
          <FluxosSections
            data={data}
            emptyFiltered={emptyFiltered}
            clientesById={clientesById}
            membrosById={membrosById}
            fotosDe={fotosDe}
          />
        ))}

      <ActionSheet
        open={menuOpen}
        onOpenChange={setMenuOpen}
        title={t('page.titlePhone')}
        hideTitle
        returnFocusRef={menuRef}
        actions={[
          {
            label: t('page.exportCsv'),
            icon: <Download />,
            disabled: !canExport,
            onSelect: onExport,
          },
          { label: t('page.print'), icon: <Printer />, onSelect: () => window.print() },
        ]}
      />
    </div>
  );
}

function FluxosSections({
  data,
  emptyFiltered,
  clientesById,
  membrosById,
  fotosDe,
}: {
  data: WorkflowAnalytics;
  emptyFiltered: boolean;
  clientesById: Map<number, Cliente>;
  membrosById: Map<number, Membro>;
  fotosDe: (clienteId: number) => string[];
}) {
  const { t } = useTranslation('analyticsFlows');
  const [showAllEtapas, setShowAllEtapas] = useState(false);
  const pontos = useMemo(
    () => buildPontos(data.semanas, data.semanas_criados_sem_conclusao),
    [data.semanas, data.semanas_criados_sem_conclusao],
  );
  const aprovacao = data.aprovacao_cliente;
  const aprovHorizonte = horizonteCaption(data.horizonte.post_events_since);
  const eventosDesde = formatDataCurta(data.horizonte.workflow_events_since);

  const etapas = useMemo(
    () => [...data.etapas].sort((a, b) => (b.media_dias ?? -1) - (a.media_dias ?? -1)),
    [data.etapas],
  );
  const etapasVisiveis = showAllEtapas ? etapas : etapas.slice(0, GARGALOS_TOP_N);
  const etapasOcultas = etapas.length - etapasVisiveis.length;

  const equipe = useMemo(
    () => [...data.equipe].sort((a, b) => b.concluidas - a.concluidas),
    [data.equipe],
  );

  return (
    <>
      <KpiRow kpis={data.kpis} emptyFiltered={emptyFiltered} />

      {/* Wide touch screens: two columns (analyticsPhone.css). */}
      <div className="phone-an-pair phone-an-stack">
        <div className="phone-an-half phone-an-stack">
          <BarList
            header={t('pace.title')}
            footer={t('pace.phoneFooter')}
            series={{ primary: t('pace.completed'), secondary: t('pace.created') }}
            color="var(--phone-ink)"
            secondaryColor="var(--phone-fill-pressed)"
            emptyText={t('pace.empty')}
            items={[...pontos].reverse().map((p) => ({
              key: p.semana,
              label: semanaDeLabel(p.semana),
              value: p.concluidos,
              secondary: p.criados,
            }))}
          />
        </div>
        <div className="phone-an-half phone-an-stack">
          {!temAtividadeAprovacao(aprovacao) ? (
            <GroupedList header={t('approval.title')} footer={aprovHorizonte ?? undefined}>
              <li className="phone-cell">
                <p className="phone-an-empty">{t('approval.empty')}</p>
              </li>
            </GroupedList>
          ) : (
            <>
              <BarList
                header={t('approval.title')}
                footer={
                  <>
                    {t('approval.median')}:{' '}
                    <strong>{formatHorasOuSemDados(aprovacao.mediana_horas)}</strong> ·{' '}
                    {t('approval.responses', { count: aprovacao.amostras })}.{' '}
                    {t('approval.waiting', { count: aprovacao.pendentes })} ·{' '}
                    {t('approval.resolvedInternally', {
                      count: aprovacao.resolvidos_internamente,
                    })}
                    {aprovacao.etapas.amostras > 0 &&
                      ` · ${t('approval.stageApprovals', {
                        count: aprovacao.etapas.amostras,
                        median: formatHorasOuSemDados(aprovacao.etapas.mediana_horas),
                      })}`}
                    {aprovHorizonte && `. ${aprovHorizonte}`}
                  </>
                }
                items={aprovacao.buckets.map((b) => ({
                  key: b.faixa,
                  label: faixaLabel(b.faixa),
                  value: b.quantidade,
                  valueLabel: t('approval.approvals', { count: b.quantidade }),
                  color:
                    b.faixa === '7d+'
                      ? 'var(--phone-an-down)'
                      : b.faixa === '3-7d'
                        ? 'var(--phone-an-warn)'
                        : 'var(--phone-ink)',
                }))}
              />
              <GroupedList header={t('approval.rankTitle')} footer={t('approval.phoneRankFooter')}>
                {aprovacao.por_cliente.length === 0 ? (
                  <li className="phone-cell">
                    <p className="phone-an-empty">{t('approval.rankEmpty')}</p>
                  </li>
                ) : (
                  aprovacao.por_cliente.slice(0, SLOW_CLIENTS_TOP_N).map((linha) => {
                    const cliente = clientesById.get(linha.cliente_id);
                    const lento =
                      linha.mediana_horas !== null && linha.mediana_horas >= LENTO_HORAS;
                    return (
                      <Cell
                        key={linha.cliente_id}
                        to={`/clientes/${linha.cliente_id}/entregas`}
                        icon={
                          <Avatar
                            src={fotosDe(linha.cliente_id)}
                            initials={(
                              cliente?.sigla ||
                              cliente?.nome?.slice(0, 2) ||
                              '?'
                            ).toUpperCase()}
                            color={cliente?.cor}
                          />
                        }
                        label={cliente?.nome ?? t('approval.removedClient')}
                        subtitle={
                          linha.amostras === 0 && linha.pendentes > 0
                            ? t('approval.waiting', { count: linha.pendentes })
                            : t('approval.responses', { count: linha.amostras })
                        }
                        value={
                          <span className={lento ? 'phone-an-tone--down' : 'phone-an-row-value'}>
                            {formatHorasOuSemDados(linha.mediana_horas)}
                          </span>
                        }
                      />
                    );
                  })
                )}
              </GroupedList>
            </>
          )}
        </div>
      </div>

      {/* Wide touch screens: two columns (analyticsPhone.css). */}
      <div className="phone-an-pair phone-an-stack">
        <div className="phone-an-half phone-an-stack">
          <BarList
            header={t('bottlenecks.title')}
            emptyText={t('bottlenecks.empty')}
            footer={
              eventosDesde
                ? t('bottlenecks.phoneFooter', { date: eventosDesde })
                : t('bottlenecks.phoneFooterNoSince')
            }
            items={etapasVisiveis.map((etapa) => ({
              key: etapa.nome,
              label: etapa.nome,
              value: etapa.media_dias ?? 0,
              valueLabel: formatDiasDecimal(etapa.media_dias),
              subtitle: [
                etapa.atraso_pct === null
                  ? t('bottlenecks.delayValue', { value: semDados() })
                  : t('bottlenecks.delayPct', { pct: Math.round(etapa.atraso_pct) }),
                etapa.retrabalho_pct !== null
                  ? t('bottlenecks.reworkPct', { pct: Math.round(etapa.retrabalho_pct) })
                  : null,
                t('bottlenecks.samplesCount', { count: etapa.amostras }),
              ]
                .filter(Boolean)
                .join(' · '),
              color:
                etapa.atraso_pct === null || etapa.atraso_pct <= 20
                  ? 'var(--teal)'
                  : etapa.atraso_pct <= 50
                    ? 'var(--phone-an-warn)'
                    : 'var(--phone-an-down)',
            }))}
          />
          {etapas.length > GARGALOS_TOP_N && (
            <button
              type="button"
              className="phone-text-button phone-text-button--strong phone-an-more-button"
              onClick={() => setShowAllEtapas((v) => !v)}
            >
              {showAllEtapas
                ? t('bottlenecks.showLess')
                : t('bottlenecks.showAll', { count: etapasOcultas })}
            </button>
          )}
        </div>
        <div className="phone-an-half phone-an-stack">
          <SectionHead title={t('team.title')} />
          <GroupedList
            aria-label={t('team.title')}
            footer={
              eventosDesde
                ? t('team.phoneFooter', { date: eventosDesde })
                : t('team.phoneFooterNoSince')
            }
          >
            {equipe.length === 0 ? (
              <li className="phone-cell">
                <p className="phone-an-empty">{t('team.empty')}</p>
              </li>
            ) : (
              equipe.map((linha) => {
                const membro = membrosById.get(linha.membro_id);
                const nome = membro?.nome ?? t('team.removedMember');
                const pouco = linha.avaliadas < MIN_AVALIADAS;
                const pct = pouco ? 0 : Math.round((linha.no_prazo / linha.avaliadas) * 100);
                const tone = pouco ? '' : pct >= 80 ? 'up' : pct >= 50 ? 'warn' : 'down';
                return (
                  <li key={linha.membro_id} className="phone-cell">
                    <div className="phone-cell__main">
                      <span className="phone-cell__icon">
                        <PessoaAvatar
                          nome={nome}
                          fotoUrl={membro?.avatar_url}
                          seed={linha.membro_id}
                          size={28}
                          className="!text-[11px] !font-bold"
                        />
                      </span>
                      <span className="phone-cell__body">
                        <span className="phone-cell__text">
                          <span className="phone-cell__label">{nome}</span>
                          {pouco && (
                            <span className="phone-an-cell-sub phone-an-cell-sub--wrap">
                              {poucosDadosTooltip()}
                            </span>
                          )}
                          <span className="phone-an-cell-sub phone-an-cell-sub--wrap">
                            {t('team.line', {
                              done: linha.concluidas,
                              avg: formatDiasDecimal(linha.media_dias),
                              returns: linha.retrabalho,
                              events: linha.atividade,
                            })}
                          </span>
                        </span>
                        <span className={`phone-an-badge${tone ? ` phone-an-badge--${tone}` : ''}`}>
                          {formatPontualidadeMembro(linha.no_prazo, linha.avaliadas)}
                        </span>
                      </span>
                    </div>
                  </li>
                );
              })
            )}
          </GroupedList>
        </div>
      </div>

      {temOrigemParaMostrar(data.origem) && (
        <GroupedList header={t('origin.title')} footer={t('origin.phoneFooter')}>
          {data.origem.map((linha) => (
            <Cell
              key={linha.origem}
              label={origemLabel(linha.origem)}
              subtitle={t('origin.avgTimeValue', {
                value: formatDiasDecimal(linha.tempo_medio_dias),
              })}
              value={t('origin.completedCount', { count: linha.concluidos })}
            />
          ))}
        </GroupedList>
      )}
    </>
  );
}
