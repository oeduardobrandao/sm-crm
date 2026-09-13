import { describe, expect, it } from 'vitest';

import { buildAnalyticsCsv, CSV_BOM, csvFilename } from '../csv';
import type { WorkflowAnalytics } from '@/services/workflowAnalytics';

/** The five buckets the RPC always returns, in its fixed order. */
function buckets(quantidades: [number, number, number, number, number] = [9, 14, 11, 6, 3]) {
  return ['<4h', '4-24h', '1-3d', '3-7d', '7d+'].map((faixa, i) => ({
    faixa,
    quantidade: quantidades[i],
  }));
}

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
      etapas_avaliadas_prev: 40,
      retrabalho_pct: 18,
      retrabalho_prev: 24,
    },
    etapas: [{ nome: 'Copy', media_dias: 5, amostras: 24, atraso_pct: 62, retrabalho_pct: 21 }],
    semanas: [{ semana: '2026-08-04', concluidos: 2, criados: 3 }],
    semanas_criados_sem_conclusao: [],
    equipe: [
      {
        membro_id: 7,
        concluidas: 18,
        media_dias: 2.1,
        no_prazo: 15,
        atrasadas: 3,
        avaliadas: 18,
        retrabalho: 2,
        atividade: 96,
      },
    ],
    horizonte: {
      workflow_events_since: '2026-07-15T09:00:00+00:00',
      post_events_since: '2026-08-01T12:00:00+00:00',
    },
    aprovacao_cliente: {
      mediana_horas: 28,
      amostras: 43,
      pendentes: 5,
      resolvidos_internamente: 2,
      buckets: buckets(),
      por_cliente: [
        { cliente_id: 1, mediana_horas: 98, amostras: 8, pendentes: 1 },
        { cliente_id: 2, mediana_horas: null, amostras: 0, pendentes: 3 },
      ],
      etapas: { amostras: 6, mediana_horas: 12 },
    },
    origem: [
      { origem: 'human', concluidos: 30, tempo_medio_dias: 5.2 },
      { origem: 'agent', concluidos: 13, tempo_medio_dias: 3.1 },
    ],
    ...overrides,
  };
}

const membros = new Map<number, string>([[7, 'Ana']]);
const clientes = new Map<number, string>([
  [1, 'Odonto Prime'],
  [2, 'Clínica Vitalis'],
]);

describe('buildAnalyticsCsv', () => {
  it('starts with the UTF-8 BOM so Excel reads the accents', () => {
    const csv = buildAnalyticsCsv(payload(), membros);

    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv).toContain('Concluídos');
  });

  it('carries every section with its rows', () => {
    const csv = buildAnalyticsCsv(payload(), membros, clientes);

    expect(csv).toContain('KPIs');
    expect(csv).toContain('Cobertura do log de eventos');
    expect(csv).toContain('Gargalos por etapa');
    expect(csv).toContain('Desempenho da equipe');
    expect(csv).toContain('Aprovação do cliente');
    expect(csv).toContain('Aprovação do cliente por faixa');
    expect(csv).toContain('Aprovação do cliente por cliente');
    expect(csv).toContain('Origem dos fluxos');
    expect(csv).toContain('Ativos agora,35');
    expect(csv).toContain('Copy,"5,0",62,21,24');
    expect(csv).toContain('Ana,18,"2,1",83%,18,2,96');
  });

  it('exports the new event-derived KPIs alongside the old ones', () => {
    const csv = buildAnalyticsCsv(payload(), membros, clientes);

    expect(csv).toContain('Retrabalho,18%');
    expect(csv).toContain('Retrabalho no período anterior,24%');
    expect(csv).toContain('Etapas avaliadas no período anterior,40');
  });

  it('states when each event source starts, so a zero is not read as a fact', () => {
    const csv = buildAnalyticsCsv(payload(), membros, clientes);

    expect(csv).toContain('Eventos de fluxo,15/07/2026');
    expect(csv).toContain('Eventos de post,01/08/2026');
  });

  it('exports the approval block with its buckets and its per-client ranking', () => {
    const csv = buildAnalyticsCsv(payload(), membros, clientes);

    expect(csv).toContain('Mediana de resposta,1d 4h');
    expect(csv).toContain('Aguardando,5');
    expect(csv).toContain('Resolvidos internamente,2');
    expect(csv).toContain('Aprovações por etapa,6');
    // The bucket keys go out verbatim: the export is joined against the RPC,
    // not against the page's prettier labels.
    expect(csv).toContain('4-24h,14');
    expect(csv).toContain('7d+,3');
    expect(csv).toContain('Odonto Prime,4d 2h,8,1');
    // A client sitting on every cycle has no median at all, and the export says
    // so instead of printing a zero.
    expect(csv).toContain('Clínica Vitalis,Sem dados,0,3');
  });

  it('labels the flow origin instead of exporting the raw column value', () => {
    const csv = buildAnalyticsCsv(payload(), membros, clientes);

    expect(csv).toContain('Humano,30,"5,2"');
    expect(csv).toContain('Agente,13,"3,1"');
    expect(csv).not.toContain('created_via');
    expect(csv).not.toContain(',agent,');
  });

  it('neutralizes a formula hiding in a cliente name', () => {
    // Client names are user input and reach the export through the ranking, so
    // they run the same gauntlet the etapa names do. `=HYPERLINK` is the one
    // that matters: it exfiltrates on open, with no macro prompt.
    const csv = buildAnalyticsCsv(
      payload(),
      membros,
      new Map([[1, '=HYPERLINK("http://evil.test","clique")']]),
    );

    expect(csv).toContain('"\'=HYPERLINK(""http://evil.test"",""clique"")"');
    expect(csv).not.toContain('\n=HYPERLINK');
  });

  it('names an unresolved cliente instead of leaking the id', () => {
    const csv = buildAnalyticsCsv(payload(), membros);

    expect(csv).toContain('Cliente removido,4d 2h,8,1');
  });

  it('refuses to state a pontualidade the table would call "Poucos dados"', () => {
    const csv = buildAnalyticsCsv(
      payload({
        equipe: [
          {
            membro_id: 7,
            concluidas: 2,
            media_dias: 1.9,
            no_prazo: 2,
            atrasadas: 0,
            avaliadas: 2,
            retrabalho: 0,
            atividade: 12,
          },
        ],
      }),
      membros,
    );

    expect(csv).toContain('Ana,2,"1,9",Poucos dados,2,0,12');
    expect(csv).not.toContain('100%');
  });

  it('neutralizes fields a spreadsheet would run as a formula', () => {
    const csv = buildAnalyticsCsv(
      payload({
        etapas: [
          { nome: '=SUM(A1)', media_dias: 1, amostras: 2, atraso_pct: 0, retrabalho_pct: null },
        ],
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
          { nome: '+1', media_dias: null, amostras: 1, atraso_pct: null, retrabalho_pct: null },
          { nome: '-1', media_dias: null, amostras: 1, atraso_pct: null, retrabalho_pct: null },
          { nome: '@ref', media_dias: null, amostras: 1, atraso_pct: null, retrabalho_pct: null },
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
          { nome: '\t=SUM(A1)', media_dias: 1, amostras: 1, atraso_pct: 0, retrabalho_pct: null },
          { nome: '  @cmd', media_dias: 1, amostras: 1, atraso_pct: 0, retrabalho_pct: null },
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
        etapas: [
          { nome: ' texto', media_dias: 1, amostras: 1, atraso_pct: 0, retrabalho_pct: null },
        ],
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
          {
            nome: 'Copy, revisão',
            media_dias: 1,
            amostras: 1,
            atraso_pct: 0,
            retrabalho_pct: null,
          },
          {
            nome: 'Aspas "duplas"',
            media_dias: 1,
            amostras: 1,
            atraso_pct: 0,
            retrabalho_pct: null,
          },
          { nome: 'Duas\nlinhas', media_dias: 1, amostras: 1, atraso_pct: 0, retrabalho_pct: null },
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
          etapas_avaliadas_prev: 0,
          retrabalho_pct: null,
          retrabalho_prev: null,
        },
        equipe: [
          {
            membro_id: 7,
            concluidas: 1,
            media_dias: null,
            no_prazo: 0,
            atrasadas: 0,
            avaliadas: 0,
            retrabalho: 0,
            atividade: 0,
          },
        ],
        horizonte: { workflow_events_since: null, post_events_since: null },
        aprovacao_cliente: {
          mediana_horas: null,
          amostras: 0,
          pendentes: 0,
          resolvidos_internamente: 0,
          buckets: buckets([0, 0, 0, 0, 0]),
          por_cliente: [],
          etapas: { amostras: 0, mediana_horas: null },
        },
        origem: [],
      }),
      membros,
    );

    expect(csv).toContain('Tempo médio,Sem dados');
    expect(csv).toContain('Pontualidade,Sem dados');
    expect(csv).toContain('Retrabalho,Sem dados');
    expect(csv).toContain('Ana,1,Sem dados,Poucos dados,0,0,0');
    expect(csv).toContain('Mediana de resposta,Sem dados');
    // A workspace whose event log has no rows at all still gets the coverage
    // section, saying plainly that there is nothing behind these numbers.
    expect(csv).toContain('Eventos de fluxo,Sem dados');
  });

  it('keeps the etapa retrabalho null distinct from a zero', () => {
    const csv = buildAnalyticsCsv(
      payload({
        etapas: [
          { nome: 'Copy', media_dias: 5, amostras: 24, atraso_pct: 62, retrabalho_pct: null },
          { nome: 'Design', media_dias: 3, amostras: 8, atraso_pct: 10, retrabalho_pct: 0 },
        ],
      }),
      membros,
    );

    expect(csv).toContain('Copy,"5,0",62,Sem dados,24');
    expect(csv).toContain('Design,"3,0",10,0,8');
  });
});

describe('csvFilename', () => {
  it('stamps the periodo and the date', () => {
    expect(csvFilename('30d', new Date(2026, 8, 2))).toBe('analytics-fluxos-30d-2026-09-02.csv');
  });
});
