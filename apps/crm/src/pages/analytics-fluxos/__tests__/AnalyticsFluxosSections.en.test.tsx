import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { i18n } from '@mesaas/i18n';
import { GargalosTable } from '../sections/GargalosTable';
import { OrigemCard } from '../sections/OrigemCard';
import { formatDataCurta, formatDiasDecimal, horizonteCaption } from '../format';
import { buildAnalyticsCsv } from '../csv';

describe('analytics de fluxos in English', () => {
  afterEach(async () => {
    await i18n.changeLanguage('pt');
  });

  it('renders the sections with English headings and captions', async () => {
    await i18n.changeLanguage('en');
    render(
      <>
        <GargalosTable
          etapas={[
            { nome: 'Copy', media_dias: 2.5, amostras: 4, atraso_pct: 25, retrabalho_pct: null },
          ]}
          eventosDesde="2026-08-04T14:30:00+00:00"
        />
        <OrigemCard
          origem={[
            { origem: 'human', concluidos: 3, tempo_medio_dias: 2.5 },
            { origem: 'agent', concluidos: 1, tempo_medio_dias: null },
          ]}
        />
      </>,
    );
    expect(screen.getByRole('heading', { name: 'Bottlenecks by stage' })).toBeInTheDocument();
    expect(screen.getByText(/rework tracked since 08\/04\/2026/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Workflow origin' })).toBeInTheDocument();
    expect(screen.getByText('Agent')).toBeInTheDocument();
    expect(screen.getByText('No data')).toBeInTheDocument();
  });

  it('formats dates, decimals and the CSV by the UI language', async () => {
    await i18n.changeLanguage('en');
    expect(formatDataCurta('2026-08-04T14:30:00+00:00')).toBe('08/04/2026');
    expect(horizonteCaption('2026-08-04T14:30:00+00:00')).toBe('Tracked since 08/04/2026');
    expect(formatDiasDecimal(5.75)).toBe('5.8d');
    const csv = buildAnalyticsCsv(
      {
        kpis: {
          concluidos: 0,
          concluidos_prev: 0,
          ativos: 0,
          tempo_medio_dias: null,
          tempo_medio_prev: null,
          pontualidade_pct: null,
          pontualidade_prev: null,
          etapas_avaliadas: 0,
          etapas_avaliadas_prev: 0,
          retrabalho_pct: null,
          retrabalho_prev: null,
        },
        etapas: [],
        semanas: [],
        semanas_criados_sem_conclusao: [],
        equipe: [],
        horizonte: { workflow_events_since: null, post_events_since: null },
        aprovacao_cliente: {
          mediana_horas: null,
          amostras: 0,
          pendentes: 0,
          resolvidos_internamente: 0,
          buckets: [],
          por_cliente: [],
          etapas: { amostras: 0, mediana_horas: null },
        },
        origem: [],
      },
      new Map(),
    );
    expect(csv).toContain('Metric,Value');
    expect(csv).toContain('Team performance');
    expect(csv).not.toContain('Métrica');
  });
});
