import { describe, expect, it } from 'vitest';

import { buildAnalyticsCsv, CSV_BOM, csvFilename } from '../csv';
import type { WorkflowAnalytics } from '@/services/workflowAnalytics';

function payload(overrides: Partial<WorkflowAnalytics> = {}): WorkflowAnalytics {
  return {
    kpis: {
      concluidos: 4,
      concluidos_prev: 3,
      ativos: 35,
      tempo_medio_dias: 5.75,
      tempo_medio_prev: 6.5,
      pontualidade_pct: 61,
      pontualidade_prev: 69,
      etapas_avaliadas: 43,
    },
    etapas: [{ nome: 'Copy', media_dias: 5, amostras: 24, atraso_pct: 62 }],
    semanas: [{ semana: '2026-08-04', concluidos: 2, criados: 3 }],
    semanas_criados_sem_conclusao: [],
    equipe: [
      { membro_id: 7, concluidas: 18, media_dias: 2.1, no_prazo: 15, atrasadas: 3, avaliadas: 18 },
    ],
    ...overrides,
  };
}

const membros = new Map<number, string>([[7, 'Ana']]);

describe('buildAnalyticsCsv', () => {
  it('starts with the UTF-8 BOM so Excel reads the accents', () => {
    const csv = buildAnalyticsCsv(payload(), membros);

    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv).toContain('Concluídos');
  });

  it('carries the three sections with their rows', () => {
    const csv = buildAnalyticsCsv(payload(), membros);

    expect(csv).toContain('KPIs');
    expect(csv).toContain('Gargalos por etapa');
    expect(csv).toContain('Desempenho da equipe');
    expect(csv).toContain('Ativos agora,35');
    expect(csv).toContain('Copy,"5,0",62,24');
    expect(csv).toContain('Ana,18,"2,1",83%,18');
  });

  it('refuses to state a pontualidade the table would call "Poucos dados"', () => {
    const csv = buildAnalyticsCsv(
      payload({
        equipe: [
          { membro_id: 7, concluidas: 2, media_dias: 1.9, no_prazo: 2, atrasadas: 0, avaliadas: 2 },
        ],
      }),
      membros,
    );

    expect(csv).toContain('Ana,2,"1,9",Poucos dados,2');
    expect(csv).not.toContain('100%');
  });

  it('neutralizes fields a spreadsheet would run as a formula', () => {
    const csv = buildAnalyticsCsv(
      payload({
        etapas: [{ nome: '=SUM(A1)', media_dias: 1, amostras: 2, atraso_pct: 0 }],
      }),
      membros,
    );

    expect(csv).toContain("'=SUM(A1)");
    expect(csv).not.toContain('\n=SUM(A1)');
  });

  it('neutralizes the other three formula lead-ins too', () => {
    const csv = buildAnalyticsCsv(
      payload({
        etapas: [
          { nome: '+1', media_dias: null, amostras: 1, atraso_pct: null },
          { nome: '-1', media_dias: null, amostras: 1, atraso_pct: null },
          { nome: '@ref', media_dias: null, amostras: 1, atraso_pct: null },
        ],
      }),
      membros,
    );

    expect(csv).toContain("'+1");
    expect(csv).toContain("'-1");
    expect(csv).toContain("'@ref");
  });

  it('neutralizes a formula hiding behind leading whitespace', () => {
    const csv = buildAnalyticsCsv(
      payload({
        etapas: [
          { nome: '\t=SUM(A1)', media_dias: 1, amostras: 1, atraso_pct: 0 },
          { nome: '  @cmd', media_dias: 1, amostras: 1, atraso_pct: 0 },
        ],
      }),
      membros,
    );

    // Excel and Sheets trim the prefix before parsing, so a guard anchored hard
    // at position 0 would wave both of these straight through.
    expect(csv).toContain("'\t=SUM(A1)");
    expect(csv).toContain("'  @cmd");
  });

  it('leaves ordinary text with a leading space alone', () => {
    const csv = buildAnalyticsCsv(
      payload({
        etapas: [{ nome: ' texto', media_dias: 1, amostras: 1, atraso_pct: 0 }],
      }),
      membros,
    );

    expect(csv).toContain(' texto,');
    expect(csv).not.toContain("' texto");
  });

  it('quotes fields holding a comma, a quote or a newline', () => {
    const csv = buildAnalyticsCsv(
      payload({
        etapas: [
          { nome: 'Copy, revisão', media_dias: 1, amostras: 1, atraso_pct: 0 },
          { nome: 'Aspas "duplas"', media_dias: 1, amostras: 1, atraso_pct: 0 },
          { nome: 'Duas\nlinhas', media_dias: 1, amostras: 1, atraso_pct: 0 },
        ],
      }),
      membros,
    );

    expect(csv).toContain('"Copy, revisão"');
    expect(csv).toContain('"Aspas ""duplas"""');
    expect(csv).toContain('"Duas\nlinhas"');
  });

  it('names an unresolved membro instead of leaking the id', () => {
    const csv = buildAnalyticsCsv(payload(), new Map());

    expect(csv).toContain('Membro removido,18');
  });

  it('writes "Sem dados" where a metric has no samples', () => {
    const csv = buildAnalyticsCsv(
      payload({
        kpis: {
          concluidos: 0,
          concluidos_prev: 0,
          ativos: 0,
          tempo_medio_dias: null,
          tempo_medio_prev: null,
          pontualidade_pct: null,
          pontualidade_prev: null,
          etapas_avaliadas: 0,
        },
        equipe: [
          {
            membro_id: 7,
            concluidas: 1,
            media_dias: null,
            no_prazo: 0,
            atrasadas: 0,
            avaliadas: 0,
          },
        ],
      }),
      membros,
    );

    expect(csv).toContain('Tempo médio,Sem dados');
    expect(csv).toContain('Pontualidade,Sem dados');
    expect(csv).toContain('Ana,1,Sem dados,Poucos dados,0');
  });
});

describe('csvFilename', () => {
  it('stamps the periodo and the date', () => {
    expect(csvFilename('30d', new Date(2026, 8, 2))).toBe('analytics-fluxos-30d-2026-09-02.csv');
  });
});
