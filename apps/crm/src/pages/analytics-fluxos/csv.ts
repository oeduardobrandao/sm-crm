import type { WorkflowAnalytics } from '@/services/workflowAnalytics';
import {
  formatDataCurta,
  formatDiasHoras,
  formatDiasNumero,
  formatHorasOuSemDados,
  formatPct,
  formatPontualidadeMembro,
  origemLabel,
  SEM_DADOS,
} from './format';
import type { Periodo } from './useFluxosFilters';
import { CSV_BOM, CSV_EOL as EOL, csvRow as row } from '@/lib/csvExport';

export { CSV_BOM, downloadCsv } from '@/lib/csvExport';

/**
 * CSV export of the page. Values are formatted exactly as the page shows them
 * (pt-BR decimals, "Sem dados" for missing metrics) so the spreadsheet and the
 * screen never disagree about a number.
 */

export function buildAnalyticsCsv(
  data: WorkflowAnalytics,
  membrosById: Map<number, string>,
  /** Names for the approval ranking. Defaults to empty so a caller with no
   *  client list still exports the section, with "Cliente removido" rows. */
  clientesById: Map<number, string> = new Map(),
): string {
  const { kpis } = data;
  const lines: string[] = [];

  lines.push('KPIs');
  lines.push(row(['Métrica', 'Valor']));
  lines.push(row(['Concluídos', kpis.concluidos]));
  lines.push(row(['Concluídos no período anterior', kpis.concluidos_prev]));
  lines.push(row(['Ativos agora', kpis.ativos]));
  lines.push(
    row([
      'Tempo médio',
      kpis.tempo_medio_dias === null ? SEM_DADOS : formatDiasHoras(kpis.tempo_medio_dias),
    ]),
  );
  lines.push(
    row([
      'Tempo médio no período anterior',
      kpis.tempo_medio_prev === null ? SEM_DADOS : formatDiasHoras(kpis.tempo_medio_prev),
    ]),
  );
  lines.push(row(['Pontualidade', formatPct(kpis.pontualidade_pct)]));
  lines.push(row(['Pontualidade no período anterior', formatPct(kpis.pontualidade_prev)]));
  lines.push(row(['Etapas avaliadas', kpis.etapas_avaliadas]));
  lines.push(row(['Etapas avaliadas no período anterior', kpis.etapas_avaliadas_prev]));
  lines.push(row(['Retrabalho', formatPct(kpis.retrabalho_pct)]));
  lines.push(row(['Retrabalho no período anterior', formatPct(kpis.retrabalho_prev)]));

  // Where the event log starts. Without it a reader cannot tell a genuine zero
  // from a metric whose window predates the log, and the export is the copy
  // that outlives the page's tooltips.
  lines.push('');
  lines.push('Cobertura do log de eventos');
  lines.push(row(['Fonte', 'Registrado desde']));
  lines.push(
    row(['Eventos de fluxo', formatDataCurta(data.horizonte.workflow_events_since) ?? SEM_DADOS]),
  );
  lines.push(
    row(['Eventos de post', formatDataCurta(data.horizonte.post_events_since) ?? SEM_DADOS]),
  );

  lines.push('');
  lines.push('Gargalos por etapa');
  lines.push(row(['Etapa', 'Tempo médio (dias)', 'Atraso (%)', 'Retrabalho (%)', 'Amostras']));
  for (const etapa of data.etapas) {
    lines.push(
      row([
        etapa.nome,
        formatDiasNumero(etapa.media_dias),
        etapa.atraso_pct === null ? SEM_DADOS : Math.round(etapa.atraso_pct),
        // Null here is "no conclusion recorded in the window", not zero. The
        // page prints a dot; the export says it in words.
        etapa.retrabalho_pct === null ? SEM_DADOS : Math.round(etapa.retrabalho_pct),
        etapa.amostras,
      ]),
    );
  }

  lines.push('');
  lines.push('Desempenho da equipe');
  lines.push(
    row([
      'Membro',
      'Concluídas',
      'Tempo médio (dias)',
      'Pontualidade',
      'Etapas avaliadas',
      'Retrabalho (devoluções)',
      'Atividade (eventos)',
    ]),
  );
  for (const membro of data.equipe) {
    lines.push(
      row([
        membrosById.get(membro.membro_id) ?? 'Membro removido',
        membro.concluidas,
        formatDiasNumero(membro.media_dias),
        // Same floor the table applies: a 2-sample "100%" is not a fact, and an
        // export that states it anyway is the version people forward around.
        formatPontualidadeMembro(membro.no_prazo, membro.avaliadas),
        membro.avaliadas,
        membro.retrabalho,
        membro.atividade,
      ]),
    );
  }

  const { aprovacao_cliente: aprovacao } = data;
  lines.push('');
  lines.push('Aprovação do cliente');
  lines.push(row(['Métrica', 'Valor']));
  lines.push(row(['Mediana de resposta', formatHorasOuSemDados(aprovacao.mediana_horas)]));
  lines.push(row(['Respostas', aprovacao.amostras]));
  lines.push(row(['Aguardando', aprovacao.pendentes]));
  lines.push(row(['Resolvidos internamente', aprovacao.resolvidos_internamente]));
  lines.push(row(['Aprovações por etapa', aprovacao.etapas.amostras]));
  lines.push(
    row([
      'Mediana das aprovações por etapa',
      formatHorasOuSemDados(aprovacao.etapas.mediana_horas),
    ]),
  );

  lines.push('');
  lines.push('Aprovação do cliente por faixa');
  lines.push(row(['Faixa', 'Quantidade']));
  for (const bucket of aprovacao.buckets) {
    lines.push(row([bucket.faixa, bucket.quantidade]));
  }

  lines.push('');
  lines.push('Aprovação do cliente por cliente');
  lines.push(row(['Cliente', 'Mediana de resposta', 'Respostas', 'Aguardando']));
  for (const linha of aprovacao.por_cliente) {
    lines.push(
      row([
        clientesById.get(linha.cliente_id) ?? 'Cliente removido',
        formatHorasOuSemDados(linha.mediana_horas),
        linha.amostras,
        linha.pendentes,
      ]),
    );
  }

  lines.push('');
  lines.push('Origem dos fluxos');
  lines.push(row(['Origem', 'Concluídos', 'Tempo médio (dias)']));
  for (const linha of data.origem) {
    lines.push(
      row([origemLabel(linha.origem), linha.concluidos, formatDiasNumero(linha.tempo_medio_dias)]),
    );
  }

  return CSV_BOM + lines.join(EOL) + EOL;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function csvFilename(periodo: Periodo, now: Date = new Date()): string {
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `analytics-fluxos-${periodo}-${stamp}.csv`;
}
