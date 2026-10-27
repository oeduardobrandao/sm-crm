import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import type { BillingPlan } from '@/services/billing';
import {
  CLIENT_BUCKETS,
  TEAM_BUCKETS,
  estimateFirstCharge,
  planUnlocks,
  recommendPlan,
  recommendationReason,
  showFreeNote,
  trialCandidates,
  type ClientBucket,
  type TeamBucket,
} from '../recommend';

const base: BillingPlan = {
  id: 'x',
  name: 'X',
  price_brl: 0,
  price_brl_annual: null,
  sort_order: 0,
  max_clients: 2,
  max_team_members: 1,
  storage_quota_bytes: null,
  feature_hub_portal: false,
  feature_analytics_reports: false,
  feature_brand_customization: false,
  max_hub_tokens: 0,
  rate_report_generations_per_month: 0,
  feature_instagram_ai: false,
  feature_auto_sync_cron: false,
  feature_leads: false,
  feature_financial: false,
  feature_contracts: false,
  feature_agenda: true,
  feature_mensagens: false,
  feature_team_chat: false,
  feature_instagram_automation: false,
  feature_briefing_audio: false,
  pagarme_12x_enabled: false,
  pagarme_installment_cents: null,
};

const allOn = {
  feature_instagram_ai: true,
  feature_auto_sync_cron: true,
  feature_leads: true,
  feature_financial: true,
  feature_contracts: true,
  feature_agenda: true,
  feature_mensagens: true,
  feature_team_chat: true,
};

const free: BillingPlan = { ...base, id: 'free', name: 'Free', sort_order: 0 };
const start: BillingPlan = {
  ...base,
  ...allOn,
  id: 'start',
  name: 'Start',
  price_brl: 99.9,
  sort_order: 1,
  max_clients: 5,
  max_team_members: 2,
  max_hub_tokens: 5,
  rate_report_generations_per_month: 5,
};
const pro: BillingPlan = {
  ...base,
  ...allOn,
  id: 'pro',
  name: 'Pro',
  price_brl: 139.9,
  sort_order: 2,
  max_clients: 15,
  max_team_members: 5,
  max_hub_tokens: 15,
  rate_report_generations_per_month: 15,
  feature_instagram_automation: true,
  feature_briefing_audio: true,
};
const max: BillingPlan = {
  ...base,
  ...allOn,
  id: 'max',
  name: 'Max',
  price_brl: 199.9,
  sort_order: 3,
  max_clients: null,
  max_team_members: null,
  max_hub_tokens: null,
  rate_report_generations_per_month: null,
  feature_instagram_automation: true,
  feature_briefing_audio: true,
};
const lifetime: BillingPlan = { ...base, id: 'lifetime', name: 'Lifetime', sort_order: 9 };

const catalog = [lifetime, max, free, pro, start];

describe('trialCandidates', () => {
  it('keeps paid self-serve plans only, cheapest first', () => {
    expect(trialCandidates(catalog).map((p) => p.id)).toEqual(['start', 'pro', 'max']);
  });
  it('breaks price ties by sort_order, then id', () => {
    const a = { ...pro, id: 'b', sort_order: 1 };
    const b = { ...pro, id: 'a', sort_order: 1 };
    const c = { ...pro, id: 'c', sort_order: 0 };
    expect(trialCandidates([a, b, c]).map((p) => p.id)).toEqual(['c', 'a', 'b']);
  });
  it('excludes annual-only plans (no monthly price)', () => {
    const annualOnly = { ...pro, price_brl: null, price_brl_annual: 1000 };
    expect(trialCandidates([annualOnly])).toEqual([]);
  });
});

describe('recommendPlan', () => {
  const pick = (c: ClientBucket, t: TeamBucket, plans = catalog) => recommendPlan(plans, c, t)?.id;

  it('picks the cheapest plan that covers clients and team', () => {
    expect(pick('1-2', '1')).toBe('start');
    expect(pick('3-5', '2')).toBe('start');
    expect(pick('6-15', '2')).toBe('pro');
    expect(pick('3-5', '3-5')).toBe('pro');
    expect(pick('16+', '1')).toBe('max');
    expect(pick('1-2', '6+')).toBe('max');
  });
  it('falls back to the last candidate when nothing fits', () => {
    expect(pick('16+', '6+', [start, pro])).toBe('pro');
  });
  it('returns null without candidates', () => {
    expect(recommendPlan([free, lifetime], '1-2', '1')).toBeNull();
    expect(recommendPlan([], '1-2', '1')).toBeNull();
  });
  it('returns null when every plan is priced only annually', () => {
    const annual = [start, pro].map((p) => ({ ...p, price_brl: null, price_brl_annual: 999 }));
    expect(recommendPlan(annual, '1-2', '1')).toBeNull();
  });
});

describe('buckets', () => {
  it('exposes labels and uppers', () => {
    expect(CLIENT_BUCKETS.map((b) => [b.id, b.label, b.upper])).toEqual([
      ['1-2', '1 a 2', 2],
      ['3-5', '3 a 5', 5],
      ['6-15', '6 a 15', 15],
      ['16+', 'Mais de 15', Infinity],
    ]);
    expect(TEAM_BUCKETS.map((b) => [b.id, b.label, b.upper])).toEqual([
      ['1', 'Só eu', 1],
      ['2', '2 pessoas', 2],
      ['3-5', '3 a 5', 5],
      ['6+', '6 ou mais', Infinity],
    ]);
  });
});

describe('planUnlocks', () => {
  const startList = [
    'Portal para o cliente aprovar os posts',
    'Relatórios do Instagram com IA',
    'Métricas atualizadas sozinhas',
    'Financeiro, contratos e leads',
    'Agenda, mensagens e chat da equipe',
  ];
  it('lists Start unlocks in order', () => {
    expect(planUnlocks(start)).toEqual(startList);
  });
  it('adds automation and briefing for Pro', () => {
    expect(planUnlocks(pro)).toEqual([
      ...startList,
      'Respostas automáticas no Instagram',
      'Briefing em áudio',
    ]);
  });
  it('omits portal and reports for Free', () => {
    const list = planUnlocks(free).join('|');
    expect(list).not.toContain('Portal');
    expect(list).not.toContain('Relatórios');
  });
  it('uses the plain reports label without AI', () => {
    expect(planUnlocks({ ...start, feature_instagram_ai: false })).toContain(
      'Relatórios do Instagram',
    );
  });
  it('joins partial groups in pt-BR', () => {
    const list = planUnlocks({
      ...base,
      feature_financial: true,
      feature_leads: true,
      feature_agenda: true,
      feature_mensagens: true,
    });
    expect(list).toEqual(['Financeiro e leads', 'Agenda e mensagens']);
    expect(planUnlocks({ ...base, feature_contracts: true })).toEqual(['Contratos', 'Agenda']);
  });
  it('never emits an em dash', () => {
    for (const p of [free, start, pro, max]) {
      for (const s of planUnlocks(p)) expect(s).not.toContain('—');
    }
  });
});

describe('recommendationReason', () => {
  it('builds the sentence', () => {
    expect(recommendationReason('6-15', '3-5')).toBe(
      'Pensado para quem atende 6 a 15 clientes com uma equipe de 3 a 5.',
    );
  });
  it('covers every bucket without em dashes', () => {
    for (const c of CLIENT_BUCKETS) {
      for (const t of TEAM_BUCKETS) {
        const s = recommendationReason(c.id, t.id);
        expect(s).not.toContain('—');
        expect(s.startsWith('Pensado para quem atende ')).toBe(true);
        expect(s.endsWith('.')).toBe(true);
      }
    }
    expect(recommendationReason('1-2', '1')).toBe(
      'Pensado para quem atende 1 a 2 clientes sem equipe.',
    );
    expect(recommendationReason('16+', '2')).toBe(
      'Pensado para quem atende mais de 15 clientes com mais uma pessoa.',
    );
    expect(recommendationReason('3-5', '6+')).toBe(
      'Pensado para quem atende 3 a 5 clientes com uma equipe de 6 ou mais.',
    );
  });
});

describe('showFreeNote', () => {
  it('is true only for the smallest answers', () => {
    expect(showFreeNote('1-2', '1')).toBe(true);
    expect(showFreeNote('1-2', '2')).toBe(false);
    expect(showFreeNote('3-5', '1')).toBe(false);
  });
});

describe('estimateFirstCharge', () => {
  it('adds 30 days by default', () => {
    const now = new Date('2026-10-27T12:00:00.000Z');
    expect(estimateFirstCharge(now).toISOString()).toBe('2026-11-26T12:00:00.000Z');
  });
  it('accepts a custom length and does not mutate the input', () => {
    const now = new Date('2026-10-27T12:00:00.000Z');
    expect(estimateFirstCharge(now, 7).toISOString()).toBe('2026-11-03T12:00:00.000Z');
    expect(now.toISOString()).toBe('2026-10-27T12:00:00.000Z');
  });
});
