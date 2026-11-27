import i18n from 'i18next';
import type { WorkflowAnalytics } from '@/services/workflowAnalytics';
import {
  formatDataCurta,
  formatDiasHoras,
  formatDiasNumero,
  formatHorasOuSemDados,
  formatPct,
  formatPontualidadeMembro,
  origemLabel,
  semDados,
} from './format';
import type { Periodo } from './useFluxosFilters';
import { CSV_BOM, CSV_EOL as EOL, csvRow as row } from '@/lib/csvExport';

export { CSV_BOM, downloadCsv } from '@/lib/csvExport';

/**
 * CSV export of the page. Values are formatted exactly as the page shows them
 * (decimals in the UI language, "No data" for missing metrics) so the spreadsheet and the
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
  const t = (key: string) => i18n.t(`analyticsFlows:csv.${key}`);
  const SEM_DADOS = semDados();

  lines.push(t('kpis'));
  lines.push(row([t('metric'), t('value')]));
  lines.push(row([t('completed'), kpis.concluidos]));
  lines.push(row([t('completedPrev'), kpis.concluidos_prev]));
  lines.push(row([t('activeNow'), kpis.ativos]));
  lines.push(
    row([
      t('avgTime'),
      kpis.tempo_medio_dias === null ? SEM_DADOS : formatDiasHoras(kpis.tempo_medio_dias),
    ]),
  );
  lines.push(
    row([
      t('avgTimePrev'),
      kpis.tempo_medio_prev === null ? SEM_DADOS : formatDiasHoras(kpis.tempo_medio_prev),
    ]),
  );
  lines.push(row([t('onTime'), formatPct(kpis.pontualidade_pct)]));
  lines.push(row([t('onTimePrev'), formatPct(kpis.pontualidade_prev)]));
  lines.push(row([t('stagesRated'), kpis.etapas_avaliadas]));
  lines.push(row([t('stagesRatedPrev'), kpis.etapas_avaliadas_prev]));
  lines.push(row([t('rework'), formatPct(kpis.retrabalho_pct)]));
  lines.push(row([t('reworkPrev'), formatPct(kpis.retrabalho_prev)]));

  // Where the event log starts. Without it a reader cannot tell a genuine zero
  // from a metric whose window predates the log, and the export is the copy
  // that outlives the page's tooltips.
  lines.push('');
  lines.push(t('coverage'));
  lines.push(row([t('source'), t('trackedSince')]));
  lines.push(
    row([t('workflowEvents'), formatDataCurta(data.horizonte.workflow_events_since) ?? SEM_DADOS]),
  );
  lines.push(
    row([t('postEvents'), formatDataCurta(data.horizonte.post_events_since) ?? SEM_DADOS]),
  );

  lines.push('');
  lines.push(t('bottlenecks'));
  lines.push(row([t('stage'), t('avgDays'), t('delayPct'), t('reworkPct'), t('samples')]));
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
  lines.push(t('team'));
  lines.push(
    row([
      t('member'),
      t('doneCol'),
      t('avgDays'),
      t('onTime'),
      t('stagesRated'),
      t('reworkReturns'),
      t('activityEvents'),
    ]),
  );
  for (const membro of data.equipe) {
    lines.push(
      row([
        membrosById.get(membro.membro_id) ?? t('removedMember'),
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
  lines.push(t('approval'));
  lines.push(row([t('metric'), t('value')]));
  lines.push(row([t('medianResponse'), formatHorasOuSemDados(aprovacao.mediana_horas)]));
  lines.push(row([t('responses'), aprovacao.amostras]));
  lines.push(row([t('waiting'), aprovacao.pendentes]));
  lines.push(row([t('resolvedInternally'), aprovacao.resolvidos_internamente]));
  lines.push(row([t('stageApprovals'), aprovacao.etapas.amostras]));
  lines.push(
    row([t('stageApprovalsMedian'), formatHorasOuSemDados(aprovacao.etapas.mediana_horas)]),
  );

  lines.push('');
  lines.push(t('byBracket'));
  lines.push(row([t('bracket'), t('quantity')]));
  for (const bucket of aprovacao.buckets) {
    lines.push(row([bucket.faixa, bucket.quantidade]));
  }

  lines.push('');
  lines.push(t('byClient'));
  lines.push(row([t('client'), t('medianResponse'), t('responses'), t('waiting')]));
  for (const linha of aprovacao.por_cliente) {
    lines.push(
      row([
        clientesById.get(linha.cliente_id) ?? t('removedClient'),
        formatHorasOuSemDados(linha.mediana_horas),
        linha.amostras,
        linha.pendentes,
      ]),
    );
  }

  lines.push('');
  lines.push(t('origin'));
  lines.push(row([t('originCol'), t('completed'), t('avgDays')]));
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
