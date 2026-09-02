import type { WorkflowAnalytics } from '@/services/workflowAnalytics';
import {
  formatDiasHoras,
  formatDiasNumero,
  formatPct,
  formatPontualidadeMembro,
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

/** Characters a spreadsheet treats as the start of a formula. */
const FORMULA_LEAD = /^[=+\-@]/;

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

  lines.push('');
  lines.push('Gargalos por etapa');
  lines.push(row(['Etapa', 'Tempo médio (dias)', 'Atraso (%)', 'Amostras']));
  for (const etapa of data.etapas) {
    lines.push(
      row([
        etapa.nome,
        formatDiasNumero(etapa.media_dias),
        etapa.atraso_pct === null ? SEM_DADOS : Math.round(etapa.atraso_pct),
        etapa.amostras,
      ]),
    );
  }

  lines.push('');
  lines.push('Desempenho da equipe');
  lines.push(
    row(['Membro', 'Concluídas', 'Tempo médio (dias)', 'Pontualidade', 'Etapas avaliadas']),
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
      ]),
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
