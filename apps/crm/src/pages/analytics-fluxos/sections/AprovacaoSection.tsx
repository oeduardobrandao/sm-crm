import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from 'i18next';
import { Link } from 'react-router-dom';
import { Chart as ReactChart } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from 'chart.js';

import { getChartTheme, useIsDark } from '@/lib/chartTheme';
import type { AprovacaoCliente } from '@/services/workflowAnalytics';
import type { Cliente } from '../../../store';
import { formatHorasOuSemDados, horizonteCaption } from '../format';
import { SectionCard, SectionEmpty } from './SectionCard';
import { ClienteFoto } from '@/components/ClienteFoto';
import { useClienteAvatars } from '@/hooks/useClienteAvatars';

// BarController explícito: esta seção usa o componente genérico do
// react-chartjs-2, que não auto-registra controller nenhum, e o tree-shaking
// de produção descarta registros de componentes tipados não importados
// (incidente de 2026-09-02 no RitmoChart, mesma classe).
ChartJS.register(CategoryScale, LinearScale, BarController, BarElement, Tooltip);

/** Rows in the "slowest clients" ranking before it stops being a ranking. */
export const SLOW_CLIENTS_TOP_N = 8;
const TOP_N = SLOW_CLIENTS_TOP_N;

/**
 * Above this many hours a client's median reads as a problem rather than a
 * number. 72h is the same boundary the histogram's warning bucket opens at, so
 * the two halves of the section agree about what "slow" means.
 */
export const LENTO_HORAS = 72;

/**
 * The RPC's bucket keys, rendered for humans. Keyed rather than positional so a
 * future bucket edit surfaces as an unmapped raw key instead of silently
 * mislabelling a bar.
 */
const FAIXA_KEY: Record<string, string> = {
  '<4h': 'lt4h',
  '4-24h': 'h4to24',
  '1-3d': 'd1to3',
  '3-7d': 'd3to7',
  '7d+': 'd7plus',
};

export function faixaLabel(faixa: string): string {
  const key = FAIXA_KEY[faixa];
  return key ? i18n.t(`analyticsFlows:approval.bucket.${key}`) : faixa;
}

interface AprovacaoSectionProps {
  aprovacao: AprovacaoCliente;
  clientesById: Map<number, Cliente>;
  /** `horizonte.post_events_since`: nothing here can see further back than the
   *  first post_status_events row, and both cards say so. */
  postEventsSince: string | null;
}

/**
 * True when any approval cycle at all touched the window: one answered, one
 * still waiting, one the agency closed itself, or an etapa-only approval.
 *
 * Exported because the page needs the same answer. Approval cycles are keyed on
 * posts, and a post does NOT need a workflow — a workspace living entirely on
 * posts avulsos (Post Express) has zero flows and real approval data, so
 * "no flows" is not the same question as "nothing happened here".
 */
export function temAtividadeAprovacao(aprovacao: AprovacaoCliente): boolean {
  return (
    aprovacao.amostras > 0 ||
    aprovacao.pendentes > 0 ||
    aprovacao.resolvidos_internamente > 0 ||
    aprovacao.etapas.amostras > 0
  );
}

/** Client identity for a ranking row: photo when there is one, coloured
 *  initials otherwise, exactly like the clients list. */
function ClienteAvatar({ cliente, fotos }: { cliente: Cliente | undefined; fotos: string[] }) {
  const sigla = (cliente?.sigla || cliente?.nome?.slice(0, 2) || '?').toUpperCase();
  const base = {
    width: 24,
    height: 24,
    borderRadius: '50%',
    flexShrink: 0,
    objectFit: 'cover' as const,
  };
  return (
    <ClienteFoto
      srcs={fotos}
      style={base}
      fallback={
        <span
          aria-hidden
          style={{
            ...base,
            background: cliente?.cor || 'var(--surface-2)',
            color: '#fff',
            fontSize: '0.6rem',
            fontWeight: 700,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {sigla}
        </span>
      }
    />
  );
}

export function AprovacaoSection({
  aprovacao,
  clientesById,
  postEventsSince,
}: AprovacaoSectionProps) {
  const { t, i18n: i18nInstance } = useTranslation('analyticsFlows');
  const isDark = useIsDark();
  const theme = useMemo(() => getChartTheme(isDark), [isDark]);
  const clientes = useMemo(() => [...clientesById.values()], [clientesById]);
  const { fotosDe } = useClienteAvatars(clientes);

  const horizonte = horizonteCaption(postEventsSince);
  const caption = (base: string) => (horizonte ? `${base} · ${horizonte}` : base);

  // Colours by bucket key, resolved from the chart theme so a theme flip
  // recolours the bars and no hex ever lands in this file.
  //
  // This is a sequential scale, not five categories: the three fast buckets
  // share one neutral hue because they carry no verdict, and only the last two
  // change colour, where the wait starts costing something. Giving each fast
  // bucket its own categorical entry would read as five unrelated groups and
  // would put `categorical[2]` (yellow) right beside the warning orange.
  const corPorFaixa = useMemo<Record<string, string>>(
    () => ({
      '<4h': theme.categorical[0],
      '4-24h': theme.categorical[0],
      '1-3d': theme.categorical[0],
      '3-7d': theme.semantic.warning,
      '7d+': theme.semantic.danger,
    }),
    [theme],
  );

  const data = useMemo<ChartData<'bar', number[], string>>(
    () => ({
      labels: aprovacao.buckets.map((b) => faixaLabel(b.faixa)),
      datasets: [
        {
          label: t('approval.approvalsSeries'),
          data: aprovacao.buckets.map((b) => b.quantidade),
          backgroundColor: aprovacao.buckets.map(
            (b, i) => corPorFaixa[b.faixa] ?? theme.categorical[i % theme.categorical.length],
          ),
          borderWidth: 0,
          borderRadius: 4,
          maxBarThickness: 44,
        },
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [aprovacao.buckets, corPorFaixa, theme, i18nInstance.language],
  );

  const options = useMemo<ChartOptions<'bar'>>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: theme.text, font: theme.font }, grid: { display: false } },
        y: {
          beginAtZero: true,
          ticks: { color: theme.text, font: theme.font, precision: 0 },
          grid: { color: theme.grid },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...theme.tooltip,
          callbacks: {
            label: (item) => t('approval.approvals', { count: item.parsed.y }),
          },
        },
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme, i18nInstance.language],
  );

  const ranking = useMemo(() => aprovacao.por_cliente.slice(0, TOP_N), [aprovacao.por_cliente]);

  if (!temAtividadeAprovacao(aprovacao)) {
    return (
      <SectionCard title={t('approval.title')} caption={caption(t('approval.caption'))}>
        <SectionEmpty>{t('approval.empty')}</SectionEmpty>
      </SectionCard>
    );
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: '1.5rem',
      }}
    >
      <SectionCard
        title={t('approval.title')}
        caption={caption(t('approval.caption'))}
        footer={
          <div style={{ marginTop: '0.85rem' }}>
            <p style={{ fontSize: '0.8rem', margin: 0 }}>
              {t('approval.median')}:{' '}
              <strong>{formatHorasOuSemDados(aprovacao.mediana_horas)}</strong>{' '}
              <span style={{ color: 'var(--text-muted)' }}>
                · {t('approval.responses', { count: aprovacao.amostras })}
              </span>
            </p>
            <p
              style={{
                fontSize: '0.72rem',
                color: 'var(--text-muted)',
                margin: '0.25rem 0 0',
              }}
            >
              {t('approval.waiting', { count: aprovacao.pendentes })} ·{' '}
              {t('approval.resolvedInternally', { count: aprovacao.resolvidos_internamente })}
              {aprovacao.etapas.amostras > 0 && (
                <>
                  {' '}
                  ·{' '}
                  {t('approval.stageApprovals', {
                    count: aprovacao.etapas.amostras,
                    median: formatHorasOuSemDados(aprovacao.etapas.mediana_horas),
                  })}
                </>
              )}
            </p>
          </div>
        }
      >
        <div style={{ position: 'relative', height: 200 }}>
          <ReactChart
            type="bar"
            data={data}
            options={options}
            role="img"
            aria-label={t('approval.chartAria')}
          />
        </div>
      </SectionCard>

      <SectionCard title={t('approval.rankTitle')} caption={caption(t('approval.rankCaption'))}>
        {ranking.length === 0 ? (
          <SectionEmpty>{t('approval.rankEmpty')}</SectionEmpty>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, fontSize: '0.8rem' }}>
            {ranking.map((linha, i) => {
              const cliente = clientesById.get(linha.cliente_id);
              const lento = linha.mediana_horas !== null && linha.mediana_horas >= LENTO_HORAS;
              return (
                <li
                  key={linha.cliente_id}
                  style={{
                    borderTop: i === 0 ? 'none' : '1px solid var(--border-color)',
                  }}
                >
                  <Link
                    to={`/clientes/${linha.cliente_id}/entregas`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.6rem',
                      padding: '0.5rem 0',
                      color: 'inherit',
                      textDecoration: 'none',
                    }}
                  >
                    <ClienteAvatar cliente={cliente} fotos={fotosDe(linha.cliente_id)} />
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {cliente?.nome ?? t('approval.removedClient')}
                    </span>
                    <strong
                      style={{
                        marginLeft: 'auto',
                        whiteSpace: 'nowrap',
                        // Only the danger tier is coloured, and with the token
                        // that clears AA as text. --warning does not, and a
                        // mid-tier tint is not worth an unreadable number.
                        ...(lento ? { color: 'var(--danger-text)' } : {}),
                      }}
                    >
                      {formatHorasOuSemDados(linha.mediana_horas)}
                    </strong>
                    <span
                      style={{
                        fontSize: '0.7rem',
                        color: 'var(--text-muted)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {/* A client with only open cycles has 0 answers, and
                          "0 respostas" hides the reason: they are still sitting
                          on them. */}
                      {linha.amostras === 0 && linha.pendentes > 0
                        ? t('approval.waiting', { count: linha.pendentes })
                        : t('approval.responses', { count: linha.amostras })}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
