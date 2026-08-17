import { readFileSync } from 'node:fs';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ClientCalendarDayButton,
  ClientePostCalendar,
  ScheduledPostOpenButton,
  type PostCalendarEvent,
} from '../ClientePostCalendar';

const css = readFileSync('apps/crm/style.css', 'utf8');
const source = readFileSync(
  'apps/crm/src/pages/cliente-detalhe/components/ClientePostCalendar.tsx',
  'utf8',
);

/**
 * Behavior + source contracts for the client post calendar, migrated from the
 * pre-split ClienteDetalhePage's ClientCalendarDayButton/ScheduledPostOpenButton
 * tests (see git history at commit ad81ea7e, before the cliente-detalhe tabs
 * split trimmed them down to pure-CSS checks in the sibling
 * `ClientePostCalendarResponsive.test.tsx`) to their new home now that the
 * calendar is its own component.
 */
describe('ClientePostCalendar', () => {
  it('scopes width containment and wrapping to the client selected-post panel', () => {
    expect(source).toContain('className="calendar-layout cliente-post-calendar"');
    expect(css).toMatch(
      /\.cliente-post-calendar[^}]*\.scheduled-panel[^{]*\{[^}]*min-width:\s*0[^}]*max-width:\s*100%/s,
    );
    expect(css).toMatch(/\.cliente-post-calendar \.item-title\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  });

  it('wraps the four-item calendar legend with phone-sized gaps', () => {
    expect(source).toContain('className="cliente-post-calendar__legend"');
    expect(css).toMatch(/\.cliente-post-calendar__legend\s*\{[^}]*flex-wrap:\s*wrap/s);
    expect(css).toMatch(
      /@media \(max-width:\s*600px\)[\s\S]*\.cliente-post-calendar__legend\s*\{[^}]*gap:/s,
    );
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

  function event(overrides: Partial<PostCalendarEvent> = {}): PostCalendarEvent {
    return {
      postId: 1,
      postTitle: 'Post de lançamento',
      workflowId: 10,
      workflowTitle: 'Posts Agosto',
      date: new Date(2026, 7, 15),
      tipo: 'feed',
      status: 'aprovado_interno',
      ...overrides,
    };
  }

  function baseProps() {
    return {
      events: [] as PostCalendarEvent[],
      calendarMonth: new Date(2026, 7, 1),
      onMonthChange: vi.fn(),
      selectedPostDay: 15,
      onSelectDay: vi.fn(),
      postUpdating: null,
      onPostStatusUpdate: vi.fn(),
      onOpenCard: vi.fn(),
    };
  }

  it('renders nothing when there are no scheduled-post events', () => {
    const { container } = render(<ClientePostCalendar {...baseProps()} events={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists events for the selected day and opens the owning card on request', () => {
    const props = baseProps();
    render(<ClientePostCalendar {...props} events={[event()]} />);

    expect(screen.getByText('Post de lançamento')).toBeInTheDocument();
    expect(screen.getByText('Posts Agosto')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Abrir publicação/i }));
    expect(props.onOpenCard).toHaveBeenCalledWith(10);
  });

  it('shows the schedule action for an internally-approved post and reports the status update', () => {
    const props = baseProps();
    render(<ClientePostCalendar {...props} events={[event({ status: 'aprovado_interno' })]} />);

    fireEvent.click(screen.getByRole('button', { name: /Agendar/ }));
    expect(props.onPostStatusUpdate).toHaveBeenCalledWith(1, 'agendado');
  });

  it('shows the mark-posted action for a scheduled post and reports the status update', () => {
    const props = baseProps();
    render(<ClientePostCalendar {...props} events={[event({ status: 'agendado' })]} />);

    fireEvent.click(screen.getByRole('button', { name: /Marcar Postado/ }));
    expect(props.onPostStatusUpdate).toHaveBeenCalledWith(1, 'postado');
  });

  it('shows no-posts-this-day copy when the selected day has no events', () => {
    const props = baseProps();
    render(<ClientePostCalendar {...props} events={[event({ date: new Date(2026, 7, 3) })]} />);
    expect(screen.getByText('Nenhuma postagem neste dia.')).toBeInTheDocument();
  });
});
