import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Download, MoreHorizontal, Printer } from 'lucide-react';
import { PhonePageHeader } from '@/components/mobile/PhonePageHeader';
import { PhoneIconButton } from '@/components/mobile/LargeTitleHeader';
import { SegmentedControl } from '@/components/mobile/SegmentedControl';
import { ActionSheet } from '@/components/mobile/ActionSheet';
import { BarList } from '@/components/mobile/BarList';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import type { WorkflowAnalytics } from '@/services/workflowAnalytics';
import type { Cliente, Membro } from '../../../store';
import { Avatar, PickerChip, SectionHead } from '../../analytics/phone/shared';
import {
  formatDataCurta,
  formatDiasDecimal,
  formatHorasOuSemDados,
  formatPontualidadeMembro,
  formatSemanaLonga,
  horizonteCaption,
  MIN_AVALIADAS,
  origemLabel,
  POUCOS_DADOS_TOOLTIP,
  SEM_DADOS,
} from '../format';
import { PERIODOS, type Periodo } from '../useFluxosFilters';
import { KpiRow } from '../sections/KpiRow';
import { buildPontos } from '../sections/RitmoChart';
import {
  FAIXA_LABEL,
  LENTO_HORAS,
  SLOW_CLIENTS_TOP_N,
  temAtividadeAprovacao,
} from '../sections/AprovacaoSection';
import { GARGALOS_TOP_N } from '../sections/GargalosTable';
import { temOrigemParaMostrar } from '../sections/OrigemCard';

/** The page hint that is a desktop tooltip, as the visible subtitle (FFluxos mockup). */
export const FLUXOS_PERIOD_HINT =
  'O período filtra pela data de conclusão. Ativos são sempre o retrato atual.';

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

const initialsOf = (nome: string) =>
  nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase() || '?';

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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);

  const clienteLabel =
    clienteId !== null ? (clientesById.get(clienteId)?.nome ?? 'não identificado') : 'todos';
  const templateLabel =
    templateId !== null
      ? (templates.find((t) => t.id === templateId)?.nome ?? 'não identificado')
      : 'todos';

  return (
    <div className="phone-kit phone-an">
      <PhonePageHeader
        title="Analytics de fluxos"
        subtitle={FLUXOS_PERIOD_HINT}
        actions={
          <PhoneIconButton
            ref={menuRef}
            label="Mais ações"
            aria-haspopup="dialog"
            onClick={() => setMenuOpen(true)}
          >
            <MoreHorizontal aria-hidden="true" />
          </PhoneIconButton>
        }
      >
        <div className="phone-an-period">
          <SegmentedControl<Periodo>
            aria-label="Período"
            options={PERIODOS}
            value={periodo}
            onChange={onPeriodo}
          />
        </div>
      </PhonePageHeader>

      <div className="phone-an-chips">
        <PickerChip<number>
          label="Cliente"
          valueLabel={clienteLabel}
          options={clientes
            .filter((c) => c.id !== undefined)
            .map((c) => ({ value: c.id as number, label: c.nome }))}
          value={clienteId}
          onChange={onClienteId}
          emptyOption={{ label: 'Cliente: todos' }}
          searchable={clientes.length > 8}
        />
        <PickerChip<number>
          label="Template"
          valueLabel={templateLabel}
          options={templates
            .filter((t) => t.id !== undefined)
            .map((t) => ({ value: t.id as number, label: t.nome }))}
          value={templateId}
          onChange={onTemplateId}
          emptyOption={{ label: 'Template: todos' }}
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
          />
        ))}

      <ActionSheet
        open={menuOpen}
        onOpenChange={setMenuOpen}
        title="Analytics de fluxos"
        hideTitle
        returnFocusRef={menuRef}
        actions={[
          { label: 'Exportar CSV', icon: <Download />, disabled: !canExport, onSelect: onExport },
          { label: 'Imprimir', icon: <Printer />, onSelect: () => window.print() },
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
}: {
  data: WorkflowAnalytics;
  emptyFiltered: boolean;
  clientesById: Map<number, Cliente>;
  membrosById: Map<number, Membro>;
}) {
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

      <BarList
        header="Ritmo de entrega"
        footer="Por semana, com os criados para ver se a fila cresce ou encolhe."
        series={{ primary: 'Concluídos', secondary: 'Criados' }}
        color="var(--phone-ink)"
        secondaryColor="var(--phone-fill-pressed)"
        emptyText="Nenhum fluxo concluído ou criado no período."
        items={[...pontos].reverse().map((p) => ({
          key: p.semana,
          label: `Semana de ${formatSemanaLonga(p.semana)}`,
          value: p.concluidos,
          secondary: p.criados,
        }))}
      />

      {!temAtividadeAprovacao(aprovacao) ? (
        <GroupedList header="Tempo de resposta do cliente" footer={aprovHorizonte ?? undefined}>
          <li className="phone-cell">
            <p className="phone-an-empty">Sem aprovações de cliente no período.</p>
          </li>
        </GroupedList>
      ) : (
        <>
          <BarList
            header="Tempo de resposta do cliente"
            footer={
              <>
                Mediana: <strong>{formatHorasOuSemDados(aprovacao.mediana_horas)}</strong> ·{' '}
                {aprovacao.amostras} {aprovacao.amostras === 1 ? 'resposta' : 'respostas'}.{' '}
                {aprovacao.pendentes} aguardando · {aprovacao.resolvidos_internamente} resolvidos
                internamente
                {aprovacao.etapas.amostras > 0 &&
                  ` · +${aprovacao.etapas.amostras} aprovações por etapa (mediana ${formatHorasOuSemDados(aprovacao.etapas.mediana_horas)})`}
                {aprovHorizonte && `. ${aprovHorizonte}`}
              </>
            }
            items={aprovacao.buckets.map((b) => ({
              key: b.faixa,
              label: FAIXA_LABEL[b.faixa] ?? b.faixa,
              value: b.quantidade,
              valueLabel: `${b.quantidade} ${b.quantidade === 1 ? 'aprovação' : 'aprovações'}`,
              color:
                b.faixa === '7d+'
                  ? 'var(--phone-an-down)'
                  : b.faixa === '3-7d'
                    ? 'var(--phone-an-warn)'
                    : 'var(--phone-ink)',
            }))}
          />
          <GroupedList
            header="Clientes mais lentos para aprovar"
            footer="Mediana de resposta. Toque para abrir as entregas do cliente."
          >
            {aprovacao.por_cliente.length === 0 ? (
              <li className="phone-cell">
                <p className="phone-an-empty">Nenhum cliente com ciclo de aprovação no período.</p>
              </li>
            ) : (
              aprovacao.por_cliente.slice(0, SLOW_CLIENTS_TOP_N).map((linha) => {
                const cliente = clientesById.get(linha.cliente_id);
                const lento = linha.mediana_horas !== null && linha.mediana_horas >= LENTO_HORAS;
                return (
                  <Cell
                    key={linha.cliente_id}
                    to={`/clientes/${linha.cliente_id}/entregas`}
                    icon={
                      <Avatar
                        src={cliente?.foto_url}
                        initials={(
                          cliente?.sigla ||
                          cliente?.nome?.slice(0, 2) ||
                          '?'
                        ).toUpperCase()}
                        color={cliente?.cor}
                      />
                    }
                    label={cliente?.nome ?? 'Cliente removido'}
                    subtitle={
                      linha.amostras === 0 && linha.pendentes > 0
                        ? `${linha.pendentes} aguardando`
                        : `${linha.amostras} ${linha.amostras === 1 ? 'resposta' : 'respostas'}`
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

      <BarList
        header="Gargalos por etapa"
        emptyText="Nenhuma etapa concluída no período."
        footer={
          eventosDesde
            ? `Tempo médio real de cada etapa concluída no período. Retrabalho registrado desde ${eventosDesde}.`
            : 'Tempo médio real de cada etapa concluída no período.'
        }
        items={etapasVisiveis.map((etapa) => ({
          key: etapa.nome,
          label: etapa.nome,
          value: etapa.media_dias ?? 0,
          valueLabel: formatDiasDecimal(etapa.media_dias),
          subtitle: [
            etapa.atraso_pct === null
              ? `Atraso: ${SEM_DADOS}`
              : `${Math.round(etapa.atraso_pct)}% atraso`,
            etapa.retrabalho_pct !== null
              ? `${Math.round(etapa.retrabalho_pct)}% retrabalho`
              : null,
            `${etapa.amostras} amostras`,
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
          {showAllEtapas ? 'Mostrar menos' : `Mostrar todas as etapas (${etapasOcultas} ocultas)`}
        </button>
      )}

      <SectionHead title="Desempenho da equipe" />
      <GroupedList
        aria-label="Desempenho da equipe"
        footer={
          eventosDesde
            ? `Sem 100% falso: pouca amostra vira Poucos dados. Retrabalho e atividade desde ${eventosDesde}.`
            : 'Sem 100% falso: pouca amostra vira Poucos dados.'
        }
      >
        {equipe.length === 0 ? (
          <li className="phone-cell">
            <p className="phone-an-empty">Nenhuma etapa concluída com responsável no período.</p>
          </li>
        ) : (
          equipe.map((linha) => {
            const membro = membrosById.get(linha.membro_id);
            const nome = membro?.nome ?? 'Membro removido';
            const pouco = linha.avaliadas < MIN_AVALIADAS;
            const pct = pouco ? 0 : Math.round((linha.no_prazo / linha.avaliadas) * 100);
            const tone = pouco ? '' : pct >= 80 ? 'up' : pct >= 50 ? 'warn' : 'down';
            return (
              <li key={linha.membro_id} className="phone-cell">
                <div className="phone-cell__main">
                  <span className="phone-cell__icon">
                    <Avatar src={membro?.avatar_url} initials={initialsOf(nome)} color="#6d28d9" />
                  </span>
                  <span className="phone-cell__body">
                    <span className="phone-cell__text">
                      <span className="phone-cell__label">{nome}</span>
                      {pouco && (
                        <span className="phone-an-cell-sub phone-an-cell-sub--wrap">
                          {POUCOS_DADOS_TOOLTIP}
                        </span>
                      )}
                      <span className="phone-an-cell-sub phone-an-cell-sub--wrap">
                        {linha.concluidas} concluídas · {formatDiasDecimal(linha.media_dias)} média
                        · {linha.retrabalho} devoluções · {linha.atividade} eventos
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

      {temOrigemParaMostrar(data.origem) && (
        <GroupedList
          header="Origem dos fluxos"
          footer="Quem criou os fluxos concluídos no período."
        >
          {data.origem.map((linha) => (
            <Cell
              key={linha.origem}
              label={origemLabel(linha.origem)}
              subtitle={`Tempo médio ${formatDiasDecimal(linha.tempo_medio_dias)}`}
              value={`${linha.concluidos} concluídos`}
            />
          ))}
        </GroupedList>
      )}
    </>
  );
}
