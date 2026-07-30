import { describe, expect, it } from 'vitest';
import { etapaDeadlineDate, formatEtapaPrazo, matchesEtapaPrazo } from '../etapaPrazo';
import type { BoardCard } from '../hooks/useEntregasData';

// Fixed "now": Wednesday 2026-07-15 10:00 local.
const NOW = new Date(2026, 6, 15, 10, 0, 0);

function makeCard(overrides: {
  data_limite?: string | null;
  iniciado_em?: string | null;
  prazo_dias?: number;
  tipo_prazo?: 'corridos' | 'uteis';
  estourado?: boolean;
  urgente?: boolean;
  diasRestantes?: number;
  horasRestantes?: number;
}): BoardCard {
  return {
    etapa: {
      data_limite: overrides.data_limite ?? null,
      iniciado_em: overrides.iniciado_em ?? null,
      prazo_dias: overrides.prazo_dias ?? 2,
      tipo_prazo: overrides.tipo_prazo ?? 'corridos',
    },
    deadline: {
      estourado: overrides.estourado ?? false,
      urgente: overrides.urgente ?? false,
      diasRestantes: overrides.diasRestantes ?? 2,
      horasRestantes: overrides.horasRestantes ?? 0,
    },
  } as BoardCard;
}

describe('etapaDeadlineDate', () => {
  it('prefers data_limite, preserving the local day', () => {
    const d = etapaDeadlineDate(makeCard({ data_limite: '2026-07-20' }));
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(6);
    expect(d?.getDate()).toBe(20);
  });

  it('derives from iniciado_em + prazo_dias when there is no data_limite', () => {
    const d = etapaDeadlineDate(
      makeCard({ iniciado_em: new Date(2026, 6, 13, 9, 0).toISOString(), prazo_dias: 2 }),
    );
    expect(d?.getDate()).toBe(15);
  });

  it('returns null when the etapa has no deadline source', () => {
    expect(etapaDeadlineDate(makeCard({}))).toBeNull();
  });
});

describe('matchesEtapaPrazo', () => {
  const dueToday = makeCard({ data_limite: '2026-07-15' });
  const dueTomorrow = makeCard({ data_limite: '2026-07-16' });
  const dueNextWeek = makeCard({ data_limite: '2026-07-22' });
  const dueFarFuture = makeCard({ data_limite: '2026-08-30' });
  const overdue = makeCard({ data_limite: '2026-07-10', estourado: true });
  const noDeadline = makeCard({});

  it('matches everything when the filter is empty', () => {
    expect(matchesEtapaPrazo(noDeadline, [], '', '', NOW)).toBe(true);
    expect(matchesEtapaPrazo(undefined, [], '', '', NOW)).toBe(true);
  });

  it('excludes cards without deadline (and posts without card) when active', () => {
    expect(matchesEtapaPrazo(noDeadline, ['hoje'], '', '', NOW)).toBe(false);
    expect(matchesEtapaPrazo(undefined, ['hoje'], '', '', NOW)).toBe(false);
  });

  it('buckets hoje / amanhã / próximos 7 dias / atrasado', () => {
    expect(matchesEtapaPrazo(dueToday, ['hoje'], '', '', NOW)).toBe(true);
    expect(matchesEtapaPrazo(dueTomorrow, ['hoje'], '', '', NOW)).toBe(false);

    expect(matchesEtapaPrazo(dueTomorrow, ['amanha'], '', '', NOW)).toBe(true);

    expect(matchesEtapaPrazo(dueNextWeek, ['proximos7'], '', '', NOW)).toBe(true);
    expect(matchesEtapaPrazo(dueFarFuture, ['proximos7'], '', '', NOW)).toBe(false);
    expect(matchesEtapaPrazo(overdue, ['proximos7'], '', '', NOW)).toBe(false);

    expect(matchesEtapaPrazo(overdue, ['atrasado'], '', '', NOW)).toBe(true);
    expect(matchesEtapaPrazo(dueToday, ['atrasado'], '', '', NOW)).toBe(false);
  });

  it('ORs multiple presets', () => {
    expect(matchesEtapaPrazo(overdue, ['atrasado', 'hoje'], '', '', NOW)).toBe(true);
    expect(matchesEtapaPrazo(dueToday, ['atrasado', 'hoje'], '', '', NOW)).toBe(true);
    expect(matchesEtapaPrazo(dueTomorrow, ['atrasado', 'hoje'], '', '', NOW)).toBe(false);
  });

  it('matches a custom range inclusively, half-open ends allowed', () => {
    expect(matchesEtapaPrazo(dueNextWeek, [], '2026-07-20', '2026-07-22', NOW)).toBe(true);
    expect(matchesEtapaPrazo(dueToday, [], '2026-07-20', '2026-07-22', NOW)).toBe(false);
    expect(matchesEtapaPrazo(dueFarFuture, [], '2026-08-01', '', NOW)).toBe(true);
    expect(matchesEtapaPrazo(dueToday, [], '', '2026-07-16', NOW)).toBe(true);
  });

  it('ORs presets with the custom range', () => {
    expect(matchesEtapaPrazo(dueFarFuture, ['hoje'], '2026-08-01', '', NOW)).toBe(true);
  });
});

describe('formatEtapaPrazo', () => {
  it('formats overdue, hours-remaining and days-remaining with urgency colors', () => {
    expect(
      formatEtapaPrazo({ estourado: true, urgente: false, diasRestantes: -3, horasRestantes: 0 }),
    ).toEqual({ label: '3d atrasado', shortLabel: '3d atr.', color: '#ef4444' });
    expect(
      formatEtapaPrazo({ estourado: false, urgente: true, diasRestantes: 0, horasRestantes: 5 }),
    ).toEqual({ label: '5h restantes', shortLabel: '5h', color: '#eab308' });
    expect(
      formatEtapaPrazo({ estourado: false, urgente: false, diasRestantes: 4, horasRestantes: 2 }),
    ).toEqual({ label: '4d restantes', shortLabel: '4d', color: 'var(--text-muted)' });
  });
});
