import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync('apps/crm/style.css', 'utf8');
const source = readFileSync(
  'apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx',
  'utf8',
);

describe('client post calendar responsive contracts', () => {
  it('uses seven shrinkable equal tracks and fixed cell heights', () => {
    expect(css).toMatch(
      /\.calendar-(?:weekdays|grid)[^{]*\{[^}]*grid-template-columns:\s*repeat\(7,\s*minmax\(0,\s*1fr\)\)/s,
    );
    expect(css).toMatch(/\.calendar-day\s*\{[^}]*height:\s*110px[^}]*min-width:\s*0/s);
    expect(css).toMatch(
      /@media \(max-width:\s*600px\)[\s\S]*\.calendar-day\s*\{[^}]*height:\s*80px/s,
    );
  });

  it('scopes width containment and wrapping to the client selected-post panel', () => {
    expect(source).toContain('className="calendar-layout cliente-post-calendar"');
    expect(css).toMatch(
      /\.cliente-post-calendar[^}]*\.scheduled-panel[^{]*\{[^}]*min-width:\s*0[^}]*max-width:\s*100%/s,
    );
    expect(css).toMatch(
      /\.cliente-post-calendar \.item-title\s*\{[^}]*overflow-wrap:\s*anywhere/s,
    );
  });
});
