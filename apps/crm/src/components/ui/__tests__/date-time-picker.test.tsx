import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, beforeAll, vi } from 'vitest';
import { DateTimePicker } from '../date-time-picker';

beforeAll(() => {
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () =>
    false;
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
});

function openPicker() {
  fireEvent.click(screen.getByRole('button', { name: /Selecionar data e hora/ }));
}

describe('DateTimePicker day markers', () => {
  it('renders no dots when dayMarkers is omitted', () => {
    render(<DateTimePicker value={new Date(2026, 6, 24, 10, 0)} />);
    fireEvent.click(screen.getByRole('button', { name: /24 jul 2026/i }));
    expect(document.querySelectorAll('[data-testid="day-dot"]').length).toBe(0);
  });

  it('renders one dot per marker color, with the tooltip label', () => {
    const markers = new Map([
      ['2026-07-24', { colors: ['#eab308', '#E1306C'], label: '2 Feed · 1 Reels' }],
    ]);
    render(<DateTimePicker value={new Date(2026, 6, 20, 10, 0)} dayMarkers={markers} />);
    fireEvent.click(screen.getByRole('button', { name: /20 jul 2026/i }));

    // react-day-picker v9 labels day buttons with the full spoken date
    // ("sexta-feira, 24 de julho de 2026"), never the bare number.
    const day24 = screen.getByRole('button', { name: /24 de julho/i });
    expect(day24).toHaveAttribute('title', '2 Feed · 1 Reels');
    expect(day24.querySelectorAll('[data-testid="day-dot"]').length).toBe(2);
  });

  // react-day-picker v9 ships English nav labels by default — the ptBR locale only
  // localizes date formatting, not these ARIA strings. Verified in
  // node_modules/react-day-picker/dist/esm/labels/labelPrevious.js.
  it('keeps the month navigation chevrons when a caller passes components', () => {
    const markers = new Map([['2026-07-24', { colors: ['#eab308'], label: '1 Feed' }]]);
    render(<DateTimePicker value={new Date(2026, 6, 20, 10, 0)} dayMarkers={markers} />);
    fireEvent.click(screen.getByRole('button', { name: /20 jul 2026/i }));
    expect(screen.getByRole('button', { name: 'Go to the Previous Month' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to the Next Month' })).toBeInTheDocument();
  });

  it('still selects a day when dots are rendered', () => {
    const onChange = vi.fn();
    const markers = new Map([['2026-07-24', { colors: ['#eab308'], label: '1 Feed' }]]);
    render(
      <DateTimePicker
        value={new Date(2026, 6, 20, 10, 0)}
        dayMarkers={markers}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /20 jul 2026/i }));
    fireEvent.click(screen.getByRole('button', { name: /24 de julho/i }));
    expect(onChange).toHaveBeenCalled();
  });
});
