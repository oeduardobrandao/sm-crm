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

/**
 * CSV export of the page. Values are formatted exactly as the page shows them
 * (pt-BR decimals, "Sem dados" for missing metrics) so the spreadsheet and the
 * screen never disagree about a number.
 */

/** Excel only reads a UTF-8 CSV as UTF-8 when it opens with the byte order mark. */
export const CSV_BOM = '﻿';

const EOL = '\r\n';

/**
 * A field a spreadsheet would evaluate: one of `= + - @` as the first character
 * that is not whitespace or a control character.
 *
 * The leading run matters. Excel and Sheets trim it before parsing, so `\t=SUM(A1)`
 * and `  =1+1` evaluate exactly like `=SUM(A1)` would; anchoring the guard
 * strictly at position 0 lets a payload walk straight past it behind one space.
 *
 * The prefix run covers control characters as well as whitespace. `\s` alone leaves
 * the C0 range through, and `\p{Cc}` states that without putting a literal control
 * character in the pattern (which is what `no-control-regex` objects to).
 */
const FORMULA_LEAD = /^[\s\p{Cc}]*[=+\-@]/u;

/**
 * One CSV field: formula-neutralized first, then quoted. Order matters. A value
 * like `=1,2` must get its leading apostrophe BEFORE the quotes, or the
 * apostrophe ends up outside them and the cell evaluates anyway.
 */
function field(value: string | number): string {
  let out = String(value);
  if (FORMULA_LEAD.test(out)) out = `'${out}`;
  if (/[",\n\r]/.test(out)) out = `"${out.replace(/"/g, '""')}"`;
  return out;
}

function row(cells: (string | number)[]): string {
  return cells.map(field).join(',');
}

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

/** Hands the built CSV to the browser as a download. */
export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
