import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MonthFilterDropdown, type MonthFilterOption } from '../MonthFilterDropdown';

const OPTIONS: MonthFilterOption[] = [
  { key: '2026-09', count: 12 },
  { key: '2026-04', count: 3 },
  { key: 'none', count: 2 },
];

/** Keeps the selection in state so flows behave like the page. */
function Harness({
  initial = 'all',
  options = OPTIONS,
  onChange,
}: {
  initial?: string;
  options?: MonthFilterOption[];
  onChange?: (next: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <MonthFilterDropdown
      value={value}
      options={options}
      onChange={(next) => {
        onChange?.(next);
        setValue(next);
      }}
    />
  );
}

describe('MonthFilterDropdown', () => {
  it('renders nothing with one option or fewer', () => {
    const { container, rerender } = render(
      <MonthFilterDropdown value="all" options={[OPTIONS[0]]} onChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(<MonthFilterDropdown value="all" options={[]} onChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('labels the trigger: all months, the picked month, or the dateless bucket', () => {
    const { rerender } = render(
      <MonthFilterDropdown value="all" options={OPTIONS} onChange={vi.fn()} />,
    );
    const trigger = screen.getByRole('button', { name: 'Todos os meses' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    rerender(<MonthFilterDropdown value="2026-04" options={OPTIONS} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Abril de 2026' })).toBeInTheDocument();

    rerender(<MonthFilterDropdown value="none" options={OPTIONS} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Sem data' })).toBeInTheDocument();
  });

  it('uses a squared 4px trigger and fills it only when a month is picked', () => {
    const { rerender } = render(
      <MonthFilterDropdown value="all" options={OPTIONS} onChange={vi.fn()} />,
    );
    const idle = screen.getByRole('button', { name: 'Todos os meses' });
    expect(idle.className).toContain('rounded-[4px]');
    expect(idle.style.background).toBe('');
    rerender(<MonthFilterDropdown value="2026-09" options={OPTIONS} onChange={vi.fn()} />);
    const active = screen.getByRole('button', { name: 'Setembro de 2026' });
    expect(active.className).toContain('rounded-[4px]');
    expect(active.style.background).toBe('var(--hub-acc)');
  });

  it('lists Todos os meses then every option with its count, marking the current one', async () => {
    render(<Harness initial="2026-04" />);
    fireEvent.click(screen.getByRole('button', { name: 'Abril de 2026' }));
    const menu = await screen.findByRole('menu', { name: 'Filtrar por mês' });
    const items = screen.getAllByRole('menuitemradio');
    expect(items).toHaveLength(4);
    ['Todos os meses', 'Setembro de 2026 (12)', 'Abril de 2026 (3)', 'Sem data (2)'].forEach(
      (name, i) => expect(items[i]).toHaveAccessibleName(name),
    );
    for (const item of items) expect(menu).toContainElement(item);
    expect(items.map((i) => i.getAttribute('aria-checked'))).toEqual([
      'false',
      'false',
      'true',
      'false',
    ]);
  });

  it('picking a month reports its key and closes the menu', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Todos os meses' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Setembro de 2026 (12)' }));
    expect(onChange).toHaveBeenCalledWith('2026-09');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Setembro de 2026' })).toBeInTheDocument();
  });

  it('the dateless option reports the none key', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Todos os meses' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Sem data (2)' }));
    expect(onChange).toHaveBeenCalledWith('none');
  });

  it('Todos os meses resets the filter', async () => {
    const onChange = vi.fn();
    render(<Harness initial="2026-04" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Abril de 2026' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Todos os meses' }));
    expect(onChange).toHaveBeenCalledWith('all');
    expect(screen.getByRole('button', { name: 'Todos os meses' })).toBeInTheDocument();
  });

  it('Escape closes the menu and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Todos os meses' });
    await user.click(trigger);
    await screen.findByRole('menu', { name: 'Filtrar por mês' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on an outside click', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button type="button">Fora</button>
        <Harness />
      </div>,
    );
    await user.click(screen.getByRole('button', { name: 'Todos os meses' }));
    await screen.findByRole('menu', { name: 'Filtrar por mês' });
    await user.click(screen.getByRole('button', { name: 'Fora' }));
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('opens with Enter, focuses the current option and moves with the arrow keys', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial="2026-09" onChange={onChange} />);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Setembro de 2026' })).toHaveFocus();
    await user.keyboard('{Enter}');
    const current = await screen.findByRole('menuitemradio', { name: 'Setembro de 2026 (12)' });
    await waitFor(() => expect(current).toHaveFocus());
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitemradio', { name: 'Abril de 2026 (3)' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('menuitemradio', { name: 'Sem data (2)' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('menuitemradio', { name: 'Todos os meses' })).toHaveFocus();
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('2026-04');
  });
});
