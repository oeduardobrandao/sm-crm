import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ClientCalendarDayButton, ScheduledPostOpenButton } from '../ClienteDetalhePage';

const css = readFileSync('apps/crm/style.css', 'utf8');
const source = readFileSync('apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx', 'utf8');

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

  it('scopes width containment and wrapping to the client selected-post panel', () => {
    expect(source).toContain('className="calendar-layout cliente-post-calendar"');
    expect(css).toMatch(
      /\.cliente-post-calendar[^}]*\.scheduled-panel[^{]*\{[^}]*min-width:\s*0[^}]*max-width:\s*100%/s,
    );
    expect(css).toMatch(/\.cliente-post-calendar \.item-title\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  });

  it('selects a native day button through keyboard activation and exposes its state', () => {
    function Harness() {
      const [selected, setSelected] = useState(false);
      return (
        <ClientCalendarDayButton
          date={new Date(2026, 6, 18)}
          dateLocale="pt-BR"
          selected={selected}
          today={false}
          hasEvents
          onSelect={() => setSelected(true)}
        >
          <span>18</span>
        </ClientCalendarDayButton>
      );
    }

    render(<Harness />);
    const day = screen.getByRole('button', { name: /18 de julho de 2026/i });
    expect(day).toHaveAttribute('aria-pressed', 'false');

    day.focus();
    fireEvent.keyDown(day, { key: 'Enter' });
    fireEvent.click(day, { detail: 0 });
    fireEvent.keyUp(day, { key: 'Enter' });

    expect(day).toHaveFocus();
    expect(day).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders and invokes the scheduled card dedicated open action', () => {
    const onOpen = vi.fn();
    render(
      <ScheduledPostOpenButton postTitle="Campanha de julho" label="Abrir post" onOpen={onOpen} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Abrir post: Campanha de julho' }));

    expect(onOpen).toHaveBeenCalledOnce();
    expect(source).not.toMatch(/className="scheduled-item"[^>]*onClick=/s);
  });

  it('wraps the four-item calendar legend with phone-sized gaps', () => {
    expect(source).toContain('className="cliente-post-calendar__legend"');
    expect(css).toMatch(/\.cliente-post-calendar__legend\s*\{[^}]*flex-wrap:\s*wrap/s);
    expect(css).toMatch(
      /@media \(max-width:\s*600px\)[\s\S]*\.cliente-post-calendar__legend\s*\{[^}]*gap:/s,
    );
  });
});
