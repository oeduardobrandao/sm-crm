import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, beforeAll, vi } from 'vitest';
import { DateTimePicker } from '../date-time-picker';

beforeAll(() => {
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () =>
    false;
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
});

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
  //
  // The accessible names below (Previous/Next Month) come from react-day-picker's OWN
  // default nav buttons and survive regardless of whether the app's custom `Chevron` is
  // merged in — getComponents() always keeps the library's PreviousMonthButton/
  // NextMonthButton, caller-supplied `components` or not. The actual regression this
  // guards is which icon renders INSIDE those buttons: the app's lucide ChevronLeft/
  // ChevronRight (merge present) vs react-day-picker's own built-in chevron (merge
  // reverted, i.e. `components={{ Chevron: ... }}` spread before `{...props}` so a
  // caller-passed `components` prop wins and wipes it out). lucide-react tags every icon
  // it renders with a `lucide-{kebab-name}` class, so assert on that.
  it('keeps the month navigation chevrons when a caller passes components', () => {
    const markers = new Map([['2026-07-24', { colors: ['#eab308'], label: '1 Feed' }]]);
    render(<DateTimePicker value={new Date(2026, 6, 20, 10, 0)} dayMarkers={markers} />);
    fireEvent.click(screen.getByRole('button', { name: /20 jul 2026/i }));
    expect(screen.getByRole('button', { name: 'Go to the Previous Month' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to the Next Month' })).toBeInTheDocument();
    // Popover content is rendered into a Radix portal appended to document.body, not into
    // the render() container — query document.body directly.
    expect(document.body.querySelector('.lucide-chevron-left')).not.toBeNull();
    expect(document.body.querySelector('.lucide-chevron-right')).not.toBeNull();
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
