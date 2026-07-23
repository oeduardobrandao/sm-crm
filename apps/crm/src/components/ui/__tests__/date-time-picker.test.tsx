import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, expect, it, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { DateTimePicker } from '../date-time-picker';

beforeAll(() => {
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () =>
    false;
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
});

describe('DateTimePicker day markers', () => {
  // Pin "today" so the DateTimePicker's Calendar (no month/defaultMonth prop, per
  // react-day-picker's getInitialMonth it always opens on the real current month) renders
  // July 2026 regardless of the actual date the suite runs on. Fake only `Date` so
  // testing-library's real timers (findBy/waitFor polling) keep working.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-15T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

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

  // Regression: react-day-picker v9's default DayButton is the ONLY place DOM focus is
  // moved (a ref + `useEffect(() => { if (modifiers.focused) ref.current?.focus(); })`).
  // rdp's own arrow-key handler (useFocus.moveFocus) only updates INTERNAL state — it never
  // touches the DOM. A custom DayButton that drops that ref/effect leaves visible DOM focus
  // stuck on the originally-focused day while rdp's internal focus (and thus which day Enter
  // would commit) silently moves on. Verified in
  // node_modules/react-day-picker/dist/esm/components/DayButton.js.
  it('moves DOM focus to the next day on ArrowRight when dots are rendered', () => {
    const markers = new Map([['2026-07-24', { colors: ['#eab308'], label: '1 Feed' }]]);
    render(<DateTimePicker value={new Date(2026, 6, 15, 10, 0)} dayMarkers={markers} />);
    fireEvent.click(screen.getByRole('button', { name: /15 jul 2026/i }));

    // Establish a real, independently-verified DOM focus baseline on day 15 (native .focus(),
    // not fireEvent.focus — jsdom's real focus() also dispatches a genuine (non-simulated)
    // focus event, which react-day-picker's onFocus handler picks up to record day 15 as its
    // internally focused day, same as a keyboard user tabbing in would).
    const day15 = screen.getByRole('button', { name: /15 de julho/i });
    act(() => {
      day15.focus();
    });
    expect(document.activeElement).toBe(day15);

    // rdp's keydown handler computes "next day" from ITS internal focused day and calls
    // setFocused — it doesn't care where DOM focus actually is, only which element the
    // keydown was dispatched on.
    fireEvent.keyDown(day15, { key: 'ArrowRight' });

    const day16 = screen.getByRole('button', { name: /16 de julho/i });
    expect(document.activeElement).toBe(day16);
  });
});

describe('day marker legend', () => {
  const legend = [
    { color: '#eab308', label: 'Feed' },
    { color: '#E1306C', label: 'Reels' },
  ];

  it('keys only the colours actually present in the markers', () => {
    const markers = new Map([['2026-07-24', { colors: ['#eab308'], label: '1 Feed' }]]);
    render(
      <DateTimePicker
        value={new Date(2026, 6, 20, 10, 0)}
        dayMarkers={markers}
        dayMarkerLegend={legend}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /20 jul 2026/i }));
    // Feed has a dot this month; Reels does not, so explaining it would be noise.
    expect(screen.getByText('Feed')).toBeInTheDocument();
    expect(screen.queryByText('Reels')).not.toBeInTheDocument();
  });

  it('renders no legend when there are no markers to explain', () => {
    const { container } = render(
      <DateTimePicker value={new Date(2026, 6, 20, 10, 0)} dayMarkerLegend={legend} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /20 jul 2026/i }));
    expect(container.querySelector('.dtp-legend')).not.toBeInTheDocument();
    expect(document.querySelector('.dtp-legend')).toBeNull();
  });
});
