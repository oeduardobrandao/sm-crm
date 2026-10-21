import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '@mesaas/i18n';
import { Dialog, DialogContent, DialogTitle } from '../dialog';
import { DatePicker } from '../date-picker';
import { MonthGrid } from '../month-grid';
import { MonthPicker } from '../month-picker';

describe('ui primitives follow the UI language', () => {
  beforeEach(async () => {
    await act(() => i18n.changeLanguage('en'));
  });
  afterEach(async () => {
    await act(() => i18n.changeLanguage('pt'));
  });

  it('dialog close confirmation is in English', () => {
    render(
      <Dialog open onOpenChange={() => {}}>
        <DialogContent confirmClose onConfirmClose={vi.fn()}>
          <DialogTitle>Title</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(screen.getByText('Close without saving?')).toBeTruthy();
    expect(screen.getByText('Close anyway')).toBeTruthy();
  });

  it('date picker placeholder', () => {
    render(<DatePicker onChange={vi.fn()} />);
    expect(screen.getByText('Select date')).toBeTruthy();
  });

  it('month picker label uses the English month/year pattern', () => {
    render(<MonthPicker value="2026-08" onChange={vi.fn()} />);
    expect(screen.getByText('August 2026')).toBeTruthy();
  });

  it('month grid weekdays and navigation', () => {
    render(
      <MonthGrid
        currentMonth={new Date(2026, 9, 1)}
        onMonthChange={vi.fn()}
        renderCell={(d) => <span>{d.getDate()}</span>}
      />,
    );
    expect(screen.getByText('Mon')).toBeTruthy();
    expect(screen.getByText('Sun')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next month' })).toBeTruthy();
    expect(screen.getByText(/October 2026/i)).toBeTruthy();
  });
});

describe('ui primitives keep Portuguese output in pt', () => {
  it('month picker label', () => {
    render(<MonthPicker value="2026-08" onChange={vi.fn()} />);
    expect(screen.getByText('Agosto de 2026')).toBeTruthy();
  });

  it('month grid weekdays', () => {
    render(
      <MonthGrid
        currentMonth={new Date(2026, 9, 1)}
        onMonthChange={vi.fn()}
        renderCell={(d) => <span>{d.getDate()}</span>}
      />,
    );
    expect(screen.getByText('Seg')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Próximo mês' })).toBeTruthy();
  });
});
