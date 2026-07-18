import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('apps/crm/style.css', 'utf8');
const source = readFileSync('apps/crm/src/pages/analytics/AnalyticsPage.tsx', 'utf8');

describe('Analytics post carousel responsive contract', () => {
  it('keeps both ranked post sections on the shared Analytics row hook', () => {
    expect(source.match(/className="analytics-posts-row"/g)).toHaveLength(2);
  });

  it('uses a five-card desktop grid and a container-relative horizontal rail on mobile', () => {
    expect(css).toMatch(
      /\.analytics-posts-row\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/s,
    );
    expect(css).toMatch(
      /@media \(max-width:\s*900px\)[\s\S]*?\.analytics-posts-row\s*\{[^}]*display:\s*flex[^}]*overflow-x:\s*auto[^}]*scroll-snap-type:\s*x mandatory/s,
    );
    expect(css).toMatch(
      /@media \(max-width:\s*900px\)[\s\S]*?\.analytics-post-card\s*\{[^}]*flex:\s*0 0 75%[^}]*min-width:\s*min\(260px,\s*75%\)[^}]*scroll-snap-align:\s*start/s,
    );
    expect(css).not.toMatch(
      /@media \(max-width:\s*900px\)[\s\S]*?\.analytics-post-card\s*\{[^}]*flex:[^}]*vw/s,
    );
  });
});
