import { afterEach, describe, expect, it } from 'vitest';
import { formatDate } from '../PostCard';

// Regression guard for the CRM↔Hub scheduled-time discrepancy: the Hub must render
// scheduled_at in the viewer's local timezone (matching the CRM), NOT pinned to UTC.
// A post scheduled late in the evening (Brazil, UTC−3) lands on the next calendar day
// in UTC — the Hub used to display that next day, one day ahead of the CRM.
describe('formatDate — timezone alignment with the CRM', () => {
  const originalTz = process.env.TZ;

  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it('renders the local calendar day, not the UTC day, for an evening slot', () => {
    process.env.TZ = 'America/Sao_Paulo';
    // 2026-07-21T01:00:00Z === 2026-07-20 22:00 in São Paulo (UTC−3).
    // Local day is the 20th; the UTC-pinned bug rendered the 21st.
    expect(formatDate('2026-07-21T01:00:00.000Z')).toContain('20');
    expect(formatDate('2026-07-21T01:00:00.000Z')).not.toContain('21');
  });
});
