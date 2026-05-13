import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TimePickerPopover } from '../TimePickerPopover';

describe('TimePickerPopover', () => {
  const baseProps = {
    date: new Date(2026, 5, 15), // June 15, 2026
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  it('displays the formatted date', () => {
    render(<TimePickerPopover {...baseProps} />);
    expect(screen.getByText(/15 de junho/i)).toBeTruthy();
  });

  it('defaults to 10:00', () => {
    render(<TimePickerPopover {...baseProps} />);
    const hourSelect = screen.getByLabelText('Hora') as HTMLSelectElement;
    const minuteSelect = screen.getByLabelText('Minuto') as HTMLSelectElement;
    expect(hourSelect.value).toBe('10');
    expect(minuteSelect.value).toBe('0');
  });

  it('uses previousTime when provided', () => {
    render(<TimePickerPopover {...baseProps} previousTime={{ hour: 14, minute: 30 }} />);
    const hourSelect = screen.getByLabelText('Hora') as HTMLSelectElement;
    const minuteSelect = screen.getByLabelText('Minuto') as HTMLSelectElement;
    expect(hourSelect.value).toBe('14');
    expect(minuteSelect.value).toBe('30');
  });

  it('calls onConfirm with local datetime on confirm click', () => {
    const onConfirm = vi.fn();
    render(<TimePickerPopover {...baseProps} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText('Confirmar'));
    const result = onConfirm.mock.calls[0][0] as Date;
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(5);
    expect(result.getDate()).toBe(15);
    expect(result.getHours()).toBe(10);
    expect(result.getMinutes()).toBe(0);
  });

  it('calls onCancel on cancel click', () => {
    const onCancel = vi.fn();
    render(<TimePickerPopover {...baseProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('Cancelar'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('reflects time selection changes in confirm output', () => {
    const onConfirm = vi.fn();
    render(<TimePickerPopover {...baseProps} onConfirm={onConfirm} />);
    fireEvent.change(screen.getByLabelText('Hora'), { target: { value: '18' } });
    fireEvent.change(screen.getByLabelText('Minuto'), { target: { value: '45' } });
    fireEvent.click(screen.getByText('Confirmar'));
    const result = onConfirm.mock.calls[0][0] as Date;
    expect(result.getHours()).toBe(18);
    expect(result.getMinutes()).toBe(45);
  });
});
