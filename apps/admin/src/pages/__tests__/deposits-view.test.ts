import { describe, expect, it } from 'vitest';
import {
  NOT_CONFIGURED_SECRET,
  formatDay,
  formatDayShort,
  formatMonth,
  monthlyReceivables,
  notConfiguredHint,
  payoutStatusBadge,
  providerName,
  rowDateLabel,
  scheduleCaption,
  waitingTotalLabel,
} from '../metricas/deposits-view';

describe('deposits-view', () => {
  it('formatDay / formatDayShort / formatMonth use pt-BR without timezone drift', () => {
    expect(formatDay('2026-09-28')).toBe('28/09/2026');
    expect(formatDayShort('2026-09-28')).toBe('seg, 28/09');
    expect(formatMonth('2026-11')).toBe('Novembro de 2026');
  });

  it('providerName', () => {
    expect(providerName('stripe')).toBe('Stripe');
    expect(providerName('pagarme')).toBe('Pagar.me');
  });

  it('scheduleCaption: Stripe schedule', () => {
    expect(scheduleCaption('stripe', { schedule_interval: 'daily', delay_days: 30 })).toBe(
      'Repasse automático diário, D+30',
    );
    expect(scheduleCaption('stripe', { schedule_interval: null, delay_days: null })).toBeNull();
    expect(scheduleCaption('stripe', { schedule_interval: 'manual', delay_days: 30 })).toBe(
      'Repasse manual: sem transferência automática',
    );
    expect(scheduleCaption('stripe', { schedule_interval: 'fortnightly', delay_days: 7 })).toBe(
      'Repasse automático, D+7',
    );
    expect(scheduleCaption('stripe', { schedule_interval: 'weekly', delay_days: null })).toBe(
      'Repasse automático semanal',
    );
  });

  it('scheduleCaption: Pagar.me transfer settings', () => {
    expect(
      scheduleCaption('pagarme', {
        transfer_enabled: true,
        transfer_interval: 'daily',
        transfer_day: null,
        anticipation_enabled: false,
        anticipation_type: null,
      }),
    ).toBe('Transferência automática diária');
    expect(
      scheduleCaption('pagarme', {
        transfer_enabled: true,
        transfer_interval: 'weekly',
        transfer_day: 3,
        anticipation_enabled: true,
        anticipation_type: 'full',
      }),
    ).toBe('Transferência automática semanal (quarta-feira) · antecipação automática ativa');
    expect(
      scheduleCaption('pagarme', {
        transfer_enabled: true,
        transfer_interval: 'monthly',
        transfer_day: 15,
        anticipation_enabled: null,
        anticipation_type: null,
      }),
    ).toBe('Transferência automática mensal (dia 15)');
    expect(
      scheduleCaption('pagarme', {
        transfer_enabled: false,
        transfer_interval: 'daily',
        transfer_day: null,
        anticipation_enabled: null,
        anticipation_type: null,
      }),
    ).toBe('Transferência automática desligada: saque manual');
    expect(scheduleCaption('pagarme', {})).toBeNull();
  });

  it('payoutStatusBadge maps provider statuses to badge variants', () => {
    expect(payoutStatusBadge('paid')).toEqual({ label: 'Pago', variant: 'success' });
    expect(payoutStatusBadge('transferred')).toEqual({ label: 'Pago', variant: 'success' });
    expect(payoutStatusBadge('pending')).toEqual({ label: 'Pendente', variant: 'info' });
    expect(payoutStatusBadge('in_transit')).toEqual({ label: 'Em trânsito', variant: 'info' });
    expect(payoutStatusBadge('processing')).toEqual({ label: 'Em trânsito', variant: 'info' });
    expect(payoutStatusBadge('pending_transfer')).toEqual({ label: 'Pendente', variant: 'info' });
    expect(payoutStatusBadge('failed')).toEqual({ label: 'Falhou', variant: 'danger' });
    expect(payoutStatusBadge('canceled')).toEqual({ label: 'Cancelado', variant: 'neutral' });
    expect(payoutStatusBadge('weird')).toEqual({ label: 'weird', variant: 'neutral' });
  });

  it('rowDateLabel distinguishes deposit vs manual withdrawal', () => {
    const base = {
      date: '2026-09-26',
      deposit_on: '2026-09-28',
      net_cents: 1,
      gross_cents: 1,
      fee_cents: 0,
      count: 1,
      kind: 'projected' as const,
    };
    expect(rowDateLabel(base)).toBe('Deposita em seg, 28/09');
    expect(rowDateLabel({ ...base, manual_withdrawal: true })).toBe('Disponível em seg, 28/09');
  });

  it('NOT_CONFIGURED_SECRET names the secret(s) per provider', () => {
    expect(NOT_CONFIGURED_SECRET.stripe).toBe('STRIPE_SECRET_KEY');
    expect(NOT_CONFIGURED_SECRET.pagarme).toBe('PAGARME_RECIPIENT_ID e PAGARME_SECRET_KEY');
  });

  it('notConfiguredHint agrees in number: singular secret for Stripe, plural secrets for Pagar.me', () => {
    expect(notConfiguredHint('stripe')).toBe(
      'Defina a secret STRIPE_SECRET_KEY na function platform-admin para ler este provedor.',
    );
    expect(notConfiguredHint('pagarme')).toBe(
      'Defina as secrets PAGARME_RECIPIENT_ID e PAGARME_SECRET_KEY na function platform-admin para ler este provedor.',
    );
  });

  it('waitingTotalLabel names the failed provider when the summary is partial', () => {
    const ok = {
      configured: true,
      ok: true,
      truncated: false,
      balance: null,
      meta: {},
      upcoming: { next30: [], byMonth: [] },
      in_transit: [],
      recent: [],
    };
    const failed = { ...ok, ok: false, error: 'unavailable' as const };
    const notConfigured = { ...ok, configured: false, ok: false };
    const summary = { next: null, next_30d_cents: 0, waiting_cents: 0, partial: false };
    expect(waitingTotalLabel({ summary, stripe: ok, pagarme: ok })).toBe('A receber (total)');
    expect(
      waitingTotalLabel({ summary: { ...summary, partial: true }, stripe: failed, pagarme: ok }),
    ).toBe('A receber (parcial: Stripe indisponível)');
    expect(
      waitingTotalLabel({
        summary: { ...summary, partial: true },
        stripe: failed,
        pagarme: failed,
      }),
    ).toBe('A receber (parcial: Stripe e Pagar.me indisponíveis)');
    // not configured is not "partial"
    expect(waitingTotalLabel({ summary, stripe: ok, pagarme: notConfigured })).toBe(
      'A receber (total)',
    );
  });

  it('waitingTotalLabel: a truncated (but ok) provider also makes the total partial', () => {
    const ok = {
      configured: true,
      ok: true,
      truncated: false,
      balance: null,
      meta: {},
      upcoming: { next30: [], byMonth: [] },
      in_transit: [],
      recent: [],
    };
    const summary = { next: null, next_30d_cents: 0, waiting_cents: 0, partial: false };
    expect(waitingTotalLabel({ summary, stripe: { ...ok, truncated: true }, pagarme: ok })).toBe(
      'A receber (parcial: lista da Stripe incompleta)',
    );
    expect(waitingTotalLabel({ summary, stripe: ok, pagarme: { ...ok, truncated: true } })).toBe(
      'A receber (parcial: lista do Pagar.me incompleta)',
    );
    // combines with a failed provider, joined by "; "
    const failed = { ...ok, ok: false, error: 'unavailable' as const };
    expect(
      waitingTotalLabel({
        summary: { ...summary, partial: true },
        stripe: failed,
        pagarme: { ...ok, truncated: true },
      }),
    ).toBe('A receber (parcial: Stripe indisponível; lista do Pagar.me incompleta)');
  });

  it('monthlyReceivables groups next30 by deposit month, adds byMonth, splits by provider, skips failed providers', () => {
    const day = (deposit_on: string, net_cents: number) => ({
      date: deposit_on,
      deposit_on,
      net_cents,
      gross_cents: net_cents + 10,
      fee_cents: 10,
      count: 1,
      kind: 'projected' as const,
    });
    const base = {
      configured: true,
      ok: true,
      truncated: false,
      balance: null,
      meta: {},
      in_transit: [],
      recent: [],
    };
    const stripe = {
      ...base,
      upcoming: {
        next30: [day('2026-09-28', 100), day('2026-10-02', 50)],
        byMonth: [{ month: '2026-11', net_cents: 700, gross_cents: 750, fee_cents: 50, count: 2 }],
      },
    };
    const pagarme = {
      ...base,
      upcoming: {
        next30: [day('2026-10-05', 300)],
        byMonth: [{ month: '2026-12', net_cents: 400, gross_cents: 420, fee_cents: 20, count: 1 }],
      },
    };
    expect(monthlyReceivables({ stripe, pagarme })).toEqual([
      { month: '2026-09', stripe_cents: 100, pagarme_cents: 0, total_cents: 100 },
      { month: '2026-10', stripe_cents: 50, pagarme_cents: 300, total_cents: 350 },
      { month: '2026-11', stripe_cents: 700, pagarme_cents: 0, total_cents: 700 },
      { month: '2026-12', stripe_cents: 0, pagarme_cents: 400, total_cents: 400 },
    ]);
    expect(monthlyReceivables({ stripe, pagarme: { ...pagarme, ok: false } })).toEqual([
      { month: '2026-09', stripe_cents: 100, pagarme_cents: 0, total_cents: 100 },
      { month: '2026-10', stripe_cents: 50, pagarme_cents: 0, total_cents: 50 },
      { month: '2026-11', stripe_cents: 700, pagarme_cents: 0, total_cents: 700 },
    ]);
  });
});
