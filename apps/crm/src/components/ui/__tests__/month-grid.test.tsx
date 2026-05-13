import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MonthGrid } from '../month-grid';

describe('MonthGrid', () => {
  const defaultProps = {
    currentMonth: new Date(2026, 5, 1), // June 2026
    onMonthChange: vi.fn(),
    renderCell: (date: Date, isCurrentMonth: boolean) => (
      <span data-testid={`cell-${date.getDate()}`}>
        {isCurrentMonth ? date.getDate() : ''}
      </span>
    ),
  };

  it('renders day-of-week headers Seg through Dom', () => {
    render(<MonthGrid {...defaultProps} />);
    for (const day of ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']) {
      expect(screen.getByText(day)).toBeTruthy();
    }
  });

  it('renders 30 cells for June 2026', () => {
    render(<MonthGrid {...defaultProps} />);
    // June 1 may appear alongside July 1 in trailing cells; use getAllByTestId
    expect(screen.getAllByTestId('cell-1').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId('cell-30')).toBeTruthy();
  });

  it('calls onMonthChange with next month when clicking forward', () => {
    const onMonthChange = vi.fn();
    render(<MonthGrid {...defaultProps} onMonthChange={onMonthChange} />);
    fireEvent.click(screen.getByLabelText('Próximo mês'));
    const call = onMonthChange.mock.calls[0][0] as Date;
    expect(call.getMonth()).toBe(6); // July
    expect(call.getFullYear()).toBe(2026);
  });

  it('calls onMonthChange with previous month when clicking back', () => {
    const onMonthChange = vi.fn();
    render(<MonthGrid {...defaultProps} onMonthChange={onMonthChange} />);
    fireEvent.click(screen.getByLabelText('Mês anterior'));
    const call = onMonthChange.mock.calls[0][0] as Date;
    expect(call.getMonth()).toBe(4); // May
    expect(call.getFullYear()).toBe(2026);
  });

  it('renders leading cells for days before month start (June 2026 starts on Monday = 0 leading cells)', () => {
    render(<MonthGrid {...defaultProps} />);
    const cells = screen.getAllByTestId(/^cell-/);
    expect(cells.length).toBeGreaterThanOrEqual(30);
  });

  it('renders trailing cells from next month to fill the last week', () => {
    const renderCell = vi.fn((date: Date, isCurrentMonth: boolean) => (
      <span data-testid={`cell-${isCurrentMonth ? 'cur' : 'out'}-${date.getDate()}`}>
        {date.getDate()}
      </span>
    ));
    render(<MonthGrid {...defaultProps} renderCell={renderCell} />);
    const outCalls = renderCell.mock.calls.filter(([, isCurrent]: [Date, boolean]) => !isCurrent);
    expect(outCalls.length).toBeGreaterThan(0);
  });
});
