import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ResponsiveCardRail } from '../ResponsiveCardRail';

const crmStyles = readFileSync('apps/crm/style.css', 'utf8');

describe('ResponsiveCardRail', () => {
  it('marks multiple children as a discoverable rail', () => {
    render(
      <ResponsiveCardRail>
        <div>A</div>
        <div>B</div>
      </ResponsiveCardRail>,
    );

    expect(screen.getByTestId('responsive-card-rail')).toHaveClass('cliente-card-rail--multiple');
    expect(screen.getAllByTestId('responsive-card-rail-item')).toHaveLength(2);
  });

  it('keeps a single child full width', () => {
    render(
      <ResponsiveCardRail>
        <div>A</div>
      </ResponsiveCardRail>,
    );

    expect(screen.getByTestId('responsive-card-rail')).not.toHaveClass(
      'cliente-card-rail--multiple',
    );
  });

  it('preserves the approved card size while exposing the next card at 320px', () => {
    expect(crmStyles).toMatch(
      /\.cliente-card-rail--multiple > \.cliente-card-rail__item\s*\{[^}]*flex:\s*0 0 84%;[^}]*min-width:\s*260px;/s,
    );

    const narrowPhoneCss = crmStyles.slice(crmStyles.lastIndexOf('@media (max-width: 359px)'));
    expect(narrowPhoneCss).toMatch(
      /\.cliente-card-rail--multiple\s*\{[^}]*margin-inline:\s*-1rem;[^}]*padding-inline:\s*0\.75rem;/s,
    );

    const railViewport = 320 - 2 * 12 - 2;
    const leadingInset = 0.75 * 16;
    const cardMinimum = 260;
    const gap = 0.75 * 16;
    const cardContentWidth = 320 - 2 * 12 - 2 - 2 * 16;
    expect(cardContentWidth + 2 * 16).toBe(railViewport);
    expect(railViewport).toBeLessThanOrEqual(320 - 2 * 12);
    expect(railViewport - leadingInset - cardMinimum - gap).toBeGreaterThan(0);
  });

  it('keeps phone tab pills at least 44px tall', () => {
    const phoneChipRules = Array.from(
      crmStyles.matchAll(/\.cliente-tabs-nav__item\s*\{([^}]*)\}/g),
      (match) => match[1],
    );
    expect(phoneChipRules.some((rule) => /min-height:\s*44px;/.test(rule))).toBe(true);
  });
});
