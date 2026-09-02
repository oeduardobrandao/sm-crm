import { describe, it, expect } from 'vitest';
import {
  aguardandoClienteCount,
  aguardandoClienteEtapaNames,
  buildAgingBuckets,
  buildClienteRows,
  buildEtapaRows,
  buildResponsavelRows,
  selectUpcoming,
} from '../chartViewData';
import type { BoardCard } from '../../hooks/useEntregasData';

interface CardOverrides {
  cliente?: { id: number; nome: string };
  membro?: { id: number; nome: string };
  etapa?: Partial<BoardCard['etapa']>;
  deadline?: Partial<BoardCard['deadline']>;
}

let seq = 0;

function card(o: CardOverrides = {}): BoardCard {
  seq += 1;
  return {
    workflow: { id: seq, titulo: `Fluxo ${seq}`, cliente_id: o.cliente?.id ?? null },
    etapa: {
      id: seq,
      workflow_id: seq,
      ordem: 0,
      nome: 'Design',
      prazo_dias: 2,
      tipo_prazo: 'corridos',
      tipo: 'padrao',
      status: 'ativo',
      ...o.etapa,
    },
    cliente: o.cliente,
    membro: o.membro,
    deadline: {
      diasRestantes: 3,
      horasRestantes: 0,
      estourado: false,
      urgente: false,
      ...o.deadline,
    },
    totalEtapas: 3,
    etapaIdx: 0,
    allEtapas: [],
  } as unknown as BoardCard;
}

/** 'YYYY-MM-DD' for `base` shifted by `offset` days, in local time. */
function isoDay(base: Date, offset: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + offset);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

const ACME = { id: 1, nome: 'Acme' };
const BETA = { id: 2, nome: 'Beta Labs' };

describe('buildClienteRows', () => {
  it('groups cards of the same cliente into one row', () => {
    const rows = buildClienteRows([card({ cliente: ACME }), card({ cliente: ACME })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe('1');
    expect(rows[0].label).toBe('Acme');
    expect(rows[0].total).toBe(2);
    expect(rows[0].counts).toEqual({ em_dia: 2, urgente: 0, atrasado: 0 });
    expect(rows[0].clickable).toBe(true);
  });

  it('ranks a cliente with 2 atrasados above one with 3 em dia', () => {
    const rows = buildClienteRows([
      card({ cliente: BETA }),
      card({ cliente: BETA }),
      card({ cliente: BETA }),
      card({ cliente: ACME, deadline: { estourado: true, diasRestantes: -2 } }),
      card({ cliente: ACME, deadline: { estourado: true, diasRestantes: -1 } }),
    ]);
    expect(rows.map((r) => r.label)).toEqual(['Acme', 'Beta Labs']);
    expect(rows[0].counts.atrasado).toBe(2);
    expect(rows[1].counts.em_dia).toBe(3);
  });

  it('caps the result at 10 rows, keeping the busiest', () => {
    const cards = Array.from({ length: 12 }, (_, i) =>
      Array.from({ length: i + 1 }, () =>
        card({ cliente: { id: i + 1, nome: `Cliente ${i + 1}` } }),
      ),
    ).flat();
    const rows = buildClienteRows(cards);
    expect(rows).toHaveLength(10);
    expect(rows[0].label).toBe('Cliente 12');
    expect(rows.map((r) => r.label)).not.toContain('Cliente 1');
  });

  it('puts cards without a cliente in a single non-clickable "Sem cliente" row', () => {
    const rows = buildClienteRows([card(), card(), card({ cliente: ACME })]);
    const semCliente = rows.find((r) => r.label === 'Sem cliente');
    expect(semCliente).toBeDefined();
    expect(semCliente!.key).toBe('');
    expect(semCliente!.total).toBe(2);
    expect(semCliente!.clickable).toBe(false);
  });
});

describe('buildResponsavelRows', () => {
  it('sends cards without a membro to the "" row and marks it non-clickable', () => {
    const rows = buildResponsavelRows([
      card({ membro: { id: 7, nome: 'Ana' } }),
      card(),
      card(),
      card(),
    ]);
    const sem = rows.find((r) => r.key === '');
    expect(sem).toBeDefined();
    expect(sem!.label).toBe('Sem responsável');
    expect(sem!.clickable).toBe(false);
    expect(sem!.total).toBe(3);

    const ana = rows.find((r) => r.key === '7');
    expect(ana!.label).toBe('Ana');
    expect(ana!.clickable).toBe(true);
  });

  it('sorts by atrasados first, then by total', () => {
    const rows = buildResponsavelRows([
      card({ membro: { id: 1, nome: 'Ana' } }),
      card({ membro: { id: 1, nome: 'Ana' } }),
      card({ membro: { id: 2, nome: 'Bruno' }, deadline: { estourado: true, diasRestantes: -4 } }),
    ]);
    expect(rows.map((r) => r.label)).toEqual(['Bruno', 'Ana']);
  });
});

describe('buildEtapaRows', () => {
  it('groups by etapa name, sorts by total desc and caps at 10', () => {
    const cards = [
      card({ etapa: { nome: 'Copy' } }),
      card({ etapa: { nome: 'Copy' } }),
      card({ etapa: { nome: 'Design' } }),
      ...Array.from({ length: 10 }, (_, i) => card({ etapa: { nome: `Etapa ${i}` } })),
    ];
    const rows = buildEtapaRows(cards);
    expect(rows).toHaveLength(10);
    expect(rows[0]).toMatchObject({ key: 'Copy', label: 'Copy', total: 2, clickable: true });
  });
});

describe('buildAgingBuckets', () => {
  const now = new Date(2026, 8, 2, 10, 0, 0);

  /** Estourada há `daysAgo` dias de calendário. */
  function overdue(daysAgo: number): BoardCard {
    return card({
      etapa: { nome: `Atrasada ${daysAgo}`, data_limite: isoDay(now, -daysAgo) },
      deadline: { estourado: true, diasRestantes: -daysAgo },
    });
  }

  it('always returns the five buckets in order, with their filter ranges', () => {
    const buckets = buildAgingBuckets([], now);
    expect(buckets.map((b) => b.label)).toEqual(['1 dia', '2 a 3', '4 a 7', '8 a 14', '15+']);
    expect(buckets.every((b) => b.count === 0)).toBe(true);
    expect(buckets[0]).toMatchObject({ fromDaysAgo: 1, toDaysAgo: 0 });
    expect(buckets[1]).toMatchObject({ fromDaysAgo: 3, toDaysAgo: 2 });
    expect(buckets[2]).toMatchObject({ fromDaysAgo: 7, toDaysAgo: 4 });
    expect(buckets[3]).toMatchObject({ fromDaysAgo: 14, toDaysAgo: 8 });
    expect(buckets[4]).toMatchObject({ fromDaysAgo: null, toDaysAgo: 15 });
  });

  it('bins overdue cards by calendar age and ignores cards that are not estouradas', () => {
    const buckets = buildAgingBuckets(
      [
        overdue(0),
        overdue(1),
        overdue(3),
        overdue(20),
        card({ etapa: { data_limite: isoDay(now, 0) }, deadline: { urgente: true } }),
        card({ etapa: { data_limite: isoDay(now, -30) } }),
      ],
      now,
    );
    const byLabel = Object.fromEntries(buckets.map((b) => [b.label, b.count]));
    expect(byLabel).toEqual({ '1 dia': 2, '2 a 3': 1, '4 a 7': 0, '8 a 14': 0, '15+': 1 });
  });

  it('bins the boundaries of every bucket', () => {
    const buckets = buildAgingBuckets(
      [overdue(2), overdue(4), overdue(7), overdue(8), overdue(14), overdue(15)],
      now,
    );
    const byLabel = Object.fromEntries(buckets.map((b) => [b.label, b.count]));
    expect(byLabel).toEqual({ '1 dia': 0, '2 a 3': 1, '4 a 7': 2, '8 a 14': 2, '15+': 1 });
  });

  it('keeps every member inside the date range its bucket drills down to', () => {
    for (let age = 0; age <= 20; age++) {
      const dia = isoDay(now, -age);
      const hits = buildAgingBuckets([overdue(age)], now).filter((b) => b.count > 0);
      expect(hits).toHaveLength(1);

      const bucket = hits[0];
      // The drill-down applies filterPrazoFrom = today - fromDaysAgo and
      // filterPrazoTo = today - toDaysAgo; 'YYYY-MM-DD' compares lexically.
      const to = isoDay(now, -bucket.toDaysAgo);
      expect(dia <= to).toBe(true);
      if (bucket.fromDaysAgo != null) {
        expect(dia >= isoDay(now, -bucket.fromDaysAgo)).toBe(true);
      }
    }
  });

  it('parks an estourada card without a deadline date in the freshest bucket', () => {
    const buckets = buildAgingBuckets(
      [card({ deadline: { estourado: true, diasRestantes: -9 } })],
      now,
    );
    const byLabel = Object.fromEntries(buckets.map((b) => [b.label, b.count]));
    expect(byLabel).toEqual({ '1 dia': 1, '2 a 3': 0, '4 a 7': 0, '8 a 14': 0, '15+': 0 });
  });
});

describe('selectUpcoming', () => {
  const now = new Date(2026, 8, 2, 10, 0, 0);

  it('"hoje" keeps only cards due today that are not estouradas', () => {
    const hoje = card({ etapa: { nome: 'Copy', data_limite: isoDay(now, 0) } });
    const amanha = card({ etapa: { nome: 'Design', data_limite: isoDay(now, 1) } });
    const atrasada = card({
      etapa: { nome: 'Captação', data_limite: isoDay(now, 0) },
      deadline: { estourado: true, diasRestantes: -1 },
    });
    const semPrazo = card({ etapa: { nome: 'Sem prazo' } });

    const result = selectUpcoming([amanha, hoje, atrasada, semPrazo], 'hoje', now);
    expect(result).toEqual([hoje]);
  });

  it('"semana" covers today through today+6, sorted by deadline', () => {
    const d6 = card({ etapa: { nome: 'D6', data_limite: isoDay(now, 6) } });
    const d0 = card({ etapa: { nome: 'D0', data_limite: isoDay(now, 0) } });
    const d3 = card({ etapa: { nome: 'D3', data_limite: isoDay(now, 3) } });
    const d7 = card({ etapa: { nome: 'D7', data_limite: isoDay(now, 7) } });
    const passado = card({ etapa: { nome: 'Ontem', data_limite: isoDay(now, -1) } });

    const result = selectUpcoming([d6, d0, d3, d7, passado], 'semana', now);
    expect(result.map((c) => c.etapa.nome)).toEqual(['D0', 'D3', 'D6']);
  });

  it('"atrasadas" returns the most overdue first and ignores the calendar date', () => {
    const um = card({ deadline: { estourado: true, diasRestantes: -1 } });
    const dez = card({ deadline: { estourado: true, diasRestantes: -10 } });
    const cinco = card({ deadline: { estourado: true, diasRestantes: -5 } });
    const emDia = card();

    const result = selectUpcoming([um, cinco, dez, emDia], 'atrasadas', now);
    expect(result.map((c) => c.deadline.diasRestantes)).toEqual([-10, -5, -1]);
  });
});

describe('aguardandoCliente', () => {
  it('counts only cards whose active etapa is an aprovacao_cliente', () => {
    const cards = [
      card({ etapa: { nome: 'Aprovação do cliente', tipo: 'aprovacao_cliente' } }),
      card({ etapa: { nome: 'Aprovação do cliente', tipo: 'aprovacao_cliente' } }),
      card({ etapa: { nome: 'Validação final', tipo: 'aprovacao_cliente' } }),
      card({ etapa: { nome: 'Design' } }),
    ];
    expect(aguardandoClienteCount(cards)).toBe(3);
    expect(aguardandoClienteEtapaNames(cards)).toEqual(['Aprovação do cliente', 'Validação final']);
  });

  it('returns zero and no names when nothing waits on the cliente', () => {
    const cards = [card(), card({ etapa: { nome: 'Copy' } })];
    expect(aguardandoClienteCount(cards)).toBe(0);
    expect(aguardandoClienteEtapaNames(cards)).toEqual([]);
  });
});
