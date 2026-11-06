import { describe, expect, it } from 'vitest';
import { relativeCreated } from '../dashboard/shared';

describe('relativeCreated', () => {
  const now = new Date('2026-10-12T12:00:00');

  it('counts calendar days', () => {
    expect(relativeCreated('2026-10-12T08:00:00', now)).toBe('hoje');
    expect(relativeCreated('2026-10-11T23:00:00', now)).toBe('ontem');
    expect(relativeCreated('2026-10-02T12:00:00', now)).toBe('há 10 dias');
  });

  it('shows a dash for an invalid date', () => {
    expect(relativeCreated('não é data', now)).toBe('—');
  });
});
