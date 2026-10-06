import { render, screen } from '@testing-library/react';
import type { EventContentArg } from '@fullcalendar/core';
import { describe, expect, it } from 'vitest';
import { ConteudoDoEvento } from '../AgendaView';

/** The selectMirror placeholder: a bare event with no `ocorrencia`. */
function espelho(view: string, allDay = false): EventContentArg {
  return {
    event: {
      extendedProps: {},
      start: new Date(2026, 9, 6, 6, 30),
      end: new Date(2026, 9, 6, 7, 0),
      allDay,
      title: '',
    },
    view: { type: view },
    isMirror: true,
    borderColor: '',
  } as unknown as EventContentArg;
}

describe('ConteudoDoEvento', () => {
  it('renders the selection mirror in the week grid (no ocorrencia)', () => {
    render(<ConteudoDoEvento arg={espelho('timeGridWeek')} />);
    expect(screen.getByText('06:30 a 07:00')).toBeInTheDocument();
  });

  it('renders an all-day selection mirror (no ocorrencia)', () => {
    const { container } = render(<ConteudoDoEvento arg={espelho('timeGridWeek', true)} />);
    expect(container.querySelector('.agenda-ev__linha')).not.toBeNull();
  });
});
