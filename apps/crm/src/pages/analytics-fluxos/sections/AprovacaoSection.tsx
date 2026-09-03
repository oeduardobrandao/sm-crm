import { useMemo } from 'react';
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

// BarController explícito: esta seção usa o componente genérico do
// react-chartjs-2, que não auto-registra controller nenhum, e o tree-shaking
// de produção descarta registros de componentes tipados não importados
// (incidente de 2026-09-02 no RitmoChart, mesma classe).
ChartJS.register(CategoryScale, LinearScale, BarController, BarElement, Tooltip);

/** Rows in the "slowest clients" ranking before it stops being a ranking. */
const TOP_N = 8;

/**
 * Above this many hours a client's median reads as a problem rather than a
 * number. 72h is the same boundary the histogram's warning bucket opens at, so
 * the two halves of the section agree about what "slow" means.
 */
const LENTO_HORAS = 72;

/**
 * The RPC's bucket keys, rendered for humans. Keyed rather than positional so a
 * future bucket edit surfaces as an unmapped raw key instead of silently
 * mislabelling a bar.
 */
const FAIXA_LABEL: Record<string, string> = {
  '<4h': '< 4h',
  '4-24h': '4 a 24h',
  '1-3d': '1 a 3d',
  '3-7d': '3 a 7d',
  '7d+': '7d+',
};

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
function ClienteAvatar({ cliente }: { cliente: Cliente | undefined }) {
  const sigla = (cliente?.sigla || cliente?.nome?.slice(0, 2) || '?').toUpperCase();
  const base = {
    width: 24,
    height: 24,
    borderRadius: '50%',
    flexShrink: 0,
    objectFit: 'cover' as const,
  };
  if (cliente?.foto_url) {
    return <img src={cliente.foto_url} alt="" loading="lazy" decoding="async" style={base} />;
  }
  return (
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
  );
}

export function AprovacaoSection({
  aprovacao,
  clientesById,
  postEventsSince,
}: AprovacaoSectionProps) {
  const isDark = useIsDark();
  const theme = useMemo(() => getChartTheme(isDark), [isDark]);

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
      labels: aprovacao.buckets.map((b) => FAIXA_LABEL[b.faixa] ?? b.faixa),
      datasets: [
        {
          label: 'Aprovações',
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
    [aprovacao.buckets, corPorFaixa, theme],
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
            label: (item) => `${item.parsed.y} ${item.parsed.y === 1 ? 'aprovação' : 'aprovações'}`,
          },
        },
      },
    }),
    [theme],
  );

  const ranking = useMemo(() => aprovacao.por_cliente.slice(0, TOP_N), [aprovacao.por_cliente]);

  if (!temAtividadeAprovacao(aprovacao)) {
    return (
      <SectionCard
        title="Tempo de resposta do cliente"
        caption={caption('quanto tempo os posts esperam na aprovação do cliente')}
      >
        <SectionEmpty>Sem aprovações de cliente no período.</SectionEmpty>
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
        title="Tempo de resposta do cliente"
        caption={caption('quanto tempo os posts esperam na aprovação do cliente')}
        footer={
          <div style={{ marginTop: '0.85rem' }}>
            <p style={{ fontSize: '0.8rem', margin: 0 }}>
              Mediana: <strong>{formatHorasOuSemDados(aprovacao.mediana_horas)}</strong>{' '}
              <span style={{ color: 'var(--text-muted)' }}>
                · {aprovacao.amostras} {aprovacao.amostras === 1 ? 'resposta' : 'respostas'}
              </span>
            </p>
            <p
              style={{
                fontSize: '0.72rem',
                color: 'var(--text-muted)',
                margin: '0.25rem 0 0',
              }}
            >
              {aprovacao.pendentes} aguardando · {aprovacao.resolvidos_internamente} resolvidos
              internamente
              {aprovacao.etapas.amostras > 0 && (
                <>
                  {' '}
                  · +{aprovacao.etapas.amostras} aprovações por etapa (mediana{' '}
                  {formatHorasOuSemDados(aprovacao.etapas.mediana_horas)})
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
            aria-label="Gráfico de barras: aprovações do cliente por faixa de tempo de resposta"
          />
        </div>
      </SectionCard>

      <SectionCard
        title="Clientes mais lentos para aprovar"
        caption={caption('mediana de resposta · abre as entregas do cliente')}
      >
        {ranking.length === 0 ? (
          <SectionEmpty>Nenhum cliente com ciclo de aprovação no período.</SectionEmpty>
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
                    <ClienteAvatar cliente={cliente} />
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {cliente?.nome ?? 'Cliente removido'}
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
                        ? `${linha.pendentes} aguardando`
                        : `${linha.amostras} ${linha.amostras === 1 ? 'resposta' : 'respostas'}`}
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
