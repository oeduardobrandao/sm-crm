import { describe, expect, it } from 'vitest';
import { describeActivity } from '../workspace-activity';

const NOW = new Date('2026-07-16T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

// The workspace itself is old, so the "new workspace" grace never interferes.
const OLD_WORKSPACE = daysAgo(400);

describe('describeActivity', () => {
  it('treats activity within 7 days as active', () => {
    expect(describeActivity(daysAgo(3), OLD_WORKSPACE, NOW).tone).toBe('active');
  });

  it('treats same-day activity as active', () => {
    expect(describeActivity(daysAgo(0), OLD_WORKSPACE, NOW).tone).toBe('active');
  });

  it('treats exactly 7 days as still active (inclusive boundary)', () => {
    expect(describeActivity(daysAgo(7), OLD_WORKSPACE, NOW).tone).toBe('active');
  });

  it('treats 8 days as cooling', () => {
    expect(describeActivity(daysAgo(8), OLD_WORKSPACE, NOW).tone).toBe('cooling');
  });

  it('treats exactly 30 days as still cooling (inclusive boundary)', () => {
    expect(describeActivity(daysAgo(30), OLD_WORKSPACE, NOW).tone).toBe('cooling');
  });

  it('treats 31 days as dormant', () => {
    expect(describeActivity(daysAgo(31), OLD_WORKSPACE, NOW).tone).toBe('dormant');
  });

  it('labels past activity in relative pt-BR', () => {
    expect(describeActivity(daysAgo(3), OLD_WORKSPACE, NOW).label).toMatch(/h[áa] 3 dias/i);
  });

  describe('never active', () => {
    it('reads "Nunca" and stays ungraded while the workspace is still new', () => {
      const result = describeActivity(null, daysAgo(2), NOW);
      expect(result.label).toBe('Nunca');
      // A brand-new workspace has not had a chance to be used — do not flag it as abandoned.
      expect(result.tone).toBe('cooling');
    });

    it('reads "Nunca" and is dormant once the workspace is past the threshold', () => {
      const result = describeActivity(null, daysAgo(31), NOW);
      expect(result.label).toBe('Nunca');
      expect(result.tone).toBe('dormant');
    });

    it('is never reported as active, however new the workspace is', () => {
      expect(describeActivity(null, daysAgo(0), NOW).tone).not.toBe('active');
    });
  });

  it('reads differently either side of the dormant cutoff, not just in colour', () => {
    // 30d and 31d must not both print "mês passado" — colour would be the only difference,
    // leaving no way to tell why one row is flagged and the neighbouring one is not.
    const cooling = describeActivity(daysAgo(30), OLD_WORKSPACE, NOW);
    const dormant = describeActivity(daysAgo(31), OLD_WORKSPACE, NOW);
    expect(cooling.tone).toBe('cooling');
    expect(dormant.tone).toBe('dormant');
    expect(cooling.label).not.toBe(dormant.label);
  });

  describe('title (hover tooltip)', () => {
    // Midday UTC so the calendar day is identical in UTC and America/Sao_Paulo — the label
    // is rendered in the viewer's zone, and the test must not depend on the runner's.
    const MIDDAY = new Date('2026-05-10T15:00:00Z').toISOString();

    it('spells out the exact date behind the relative label', () => {
      const { title } = describeActivity(MIDDAY, OLD_WORKSPACE, NOW);
      expect(title).toContain('10');
      expect(title).toContain('2026');
      expect(title).toMatch(/maio/i);
    });

    it('includes the time, not just the day', () => {
      const { title } = describeActivity(MIDDAY, OLD_WORKSPACE, NOW);
      expect(title).toMatch(/\d{2}:\d{2}/);
    });

    it('says something useful rather than a date when nothing was ever recorded', () => {
      const { title } = describeActivity(null, daysAgo(31), NOW);
      expect(title).toMatch(/nenhuma atividade/i);
    });

    it('never just repeats the relative label', () => {
      const r = describeActivity(MIDDAY, OLD_WORKSPACE, NOW);
      expect(r.title).not.toBe(r.label);
    });
  });

  it('does not read the clock internally (same inputs, same output)', () => {
    const a = describeActivity(daysAgo(10), OLD_WORKSPACE, NOW);
    const b = describeActivity(daysAgo(10), OLD_WORKSPACE, NOW);
    expect(a).toEqual(b);
  });
});
