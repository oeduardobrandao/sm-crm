import { describe, it, expect } from 'vitest';
import {
  statusMeta,
  hasSubscription,
  intervalLabel,
  intervalSuffix,
  formatMoney,
  toneBadgeClass,
} from '../subscription';

describe('subscription helpers', () => {
  describe('statusMeta', () => {
    it('maps known Stripe statuses to label + tone', () => {
      expect(statusMeta('active')).toEqual({ label: 'Ativo', tone: 'success' });
      expect(statusMeta('past_due')).toEqual({ label: 'Pagamento pendente', tone: 'warning' });
      expect(statusMeta('unpaid').tone).toBe('danger');
      expect(statusMeta('canceled').tone).toBe('muted');
    });
    it('falls back to the raw status with a muted tone', () => {
      expect(statusMeta('something_new')).toEqual({ label: 'something_new', tone: 'muted' });
    });
    it('renders a dash for no status', () => {
      expect(statusMeta(null).label).toBe('—');
      expect(statusMeta(undefined).label).toBe('—');
    });
  });

  describe('hasSubscription', () => {
    it('is true only when a status is present', () => {
      expect(hasSubscription({ status: 'active' })).toBe(true);
      expect(hasSubscription({ status: null })).toBe(false);
      expect(hasSubscription(null)).toBe(false);
      expect(hasSubscription(undefined)).toBe(false);
    });
  });

  describe('interval helpers', () => {
    it('labels and suffixes known intervals', () => {
      expect(intervalLabel('month')).toBe('mensal');
      expect(intervalLabel('year')).toBe('anual');
      expect(intervalSuffix('month')).toBe('/mês');
      expect(intervalSuffix('year')).toBe('/ano');
    });
    it('handles null/unknown', () => {
      expect(intervalLabel(null)).toBeNull();
      expect(intervalLabel('week')).toBe('week');
      expect(intervalSuffix(null)).toBe('');
      expect(intervalSuffix('week')).toBe('');
    });
  });

  describe('formatMoney', () => {
    it('formats centavos as BRL', () => {
      // pt-BR currency uses a non-breaking space after "R$", so match loosely.
      expect(formatMoney(13990)).toMatch(/^R\$\s139,90$/);
      expect(formatMoney(0)).toMatch(/^R\$\s0,00$/);
    });
    it('returns a dash for null', () => {
      expect(formatMoney(null)).toBe('—');
      expect(formatMoney(undefined)).toBe('—');
    });
  });

  describe('toneBadgeClass', () => {
    it('maps each tone to classes', () => {
      expect(toneBadgeClass('success')).toContain('text-success');
      expect(toneBadgeClass('warning')).toContain('text-warning');
      expect(toneBadgeClass('danger')).toContain('text-destructive');
      expect(toneBadgeClass('muted')).toContain('text-muted-foreground');
    });
  });
});
