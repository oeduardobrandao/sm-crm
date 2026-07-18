import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ResponsiveCardRail } from '../ResponsiveCardRail';

const crmStyles = readFileSync('apps/crm/style.css', 'utf8');
const clienteDetalheSource = readFileSync(
  'apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx',
  'utf8',
);

describe('ResponsiveCardRail', () => {
  it('marks multiple children as a discoverable rail', () => {
    render(
      <ResponsiveCardRail>
        <div>A</div>
        <div>B</div>
      </ResponsiveCardRail>,
    );

    expect(screen.getByTestId('responsive-card-rail')).toHaveClass(
      'cliente-card-rail--multiple',
    );
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
      /\.cliente-card-rail--multiple,\s*\.ig-posts-list__body\s*\{[^}]*margin-inline:\s*-1rem;[^}]*padding-inline:\s*0\.75rem;/s,
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

  it('keeps phone section chips at least 44px tall', () => {
    const phoneChipRules = Array.from(
      crmStyles.matchAll(/\.cliente-detalhe-nav__item\s*\{([^}]*)\}/g),
      (match) => match[1],
    );
    expect(phoneChipRules.some((rule) => /min-height:\s*44px;/.test(rule))).toBe(true);
  });

  it('gives date and address icon actions localized names and decorative icons', () => {
    const dateActions = clienteDetalheSource.slice(
      clienteDetalheSource.indexOf('className="cliente-date-card"'),
      clienteDetalheSource.indexOf('{/* Addresses Section */}'),
    );
    expect(dateActions).toContain(
      "aria-label={`${t('detail.editDate')}: ${d.titulo}`}",
    );
    expect(dateActions).toContain(
      "aria-label={`${t('detail.removeDate')}: ${d.titulo}`}",
    );
    expect(dateActions.match(/<(?:Pencil|Trash2)[^>]*aria-hidden="true"/g)).toHaveLength(2);

    const addressActions = clienteDetalheSource.slice(
      clienteDetalheSource.indexOf('className="cliente-address-card"'),
      clienteDetalheSource.indexOf('{!isAgent && ('),
    );
    expect(addressActions).toContain(
      "aria-label={`${t('detail.editAddress')}: ${addr.logradouro}, ${addr.numero}`}",
    );
    expect(addressActions).toContain(
      "aria-label={`${t('detail.removeAddress')}: ${addr.logradouro}, ${addr.numero}`}",
    );
    expect(addressActions.match(/<(?:Pencil|Trash2)[^>]*aria-hidden="true"/g)).toHaveLength(2);
  });
});
