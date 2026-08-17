import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('apps/crm/style.css', 'utf8');

/**
 * These three checks are pure CSS contracts with no dependency on which
 * component renders the calendar markup, so they survived the
 * cliente-detalhe tab-shell restructuring untouched — see git history for
 * this file's other tests (ClientCalendarDayButton/ScheduledPostOpenButton
 * behavior, plus the ClienteDetalhePage-source-scoped assertions), which
 * pinned code that moved out of ClienteDetalhePage.tsx and belong with
 * whichever tab rebuilds the delivery calendar.
 */
describe('client post calendar responsive contracts', () => {
  it('uses seven shrinkable equal tracks for weekday labels and calendar days independently', () => {
    expect(css).toMatch(
      /\.calendar-weekdays\s*\{[^}]*grid-template-columns:\s*repeat\(7,\s*minmax\(0,\s*1fr\)\)/s,
    );
    expect(css).toMatch(
      /\.calendar-grid\s*\{[^}]*grid-template-columns:\s*repeat\(7,\s*minmax\(0,\s*1fr\)\)/s,
    );
  });

  it('keeps the phone weekday and day grids on the same four-pixel gap', () => {
    const phoneRules = css.slice(
      css.indexOf('/* Calendar responsive */'),
      css.indexOf('/* ===== Client Link ===== */'),
    );
    expect(phoneRules).toMatch(/\.calendar-weekdays\s*\{[^}]*gap:\s*4px/s);
    expect(phoneRules).toMatch(/\.calendar-grid\s*\{[^}]*gap:\s*4px/s);
  });

  it('uses fixed responsive cell heights', () => {
    expect(css).toMatch(/\.calendar-day\s*\{[^}]*height:\s*110px[^}]*min-width:\s*0/s);
    expect(css).toMatch(
      /@media \(max-width:\s*600px\)[\s\S]*\.calendar-day\s*\{[^}]*height:\s*80px/s,
    );
  });
});
