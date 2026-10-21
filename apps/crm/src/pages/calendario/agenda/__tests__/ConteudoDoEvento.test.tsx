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

describe('ConteudoDoEvento: layer items', () => {
  function camada(view: string, item: Record<string, unknown>, start: Date): EventContentArg {
    return {
      event: {
        extendedProps: { camada: item },
        start,
        end: null,
        allDay: false,
        title: 'Carrossel',
      },
      view: { type: view },
      isMirror: false,
      borderColor: '#0ea5e9',
    } as unknown as EventContentArg;
  }

  it('renders a post as its icon, time and title on one line', () => {
    const { container } = render(
      <ConteudoDoEvento
        arg={camada(
          'timeGridWeek',
          { camada: 'posts', post: { platform: 'instagram' } },
          new Date(2026, 9, 6, 10, 0),
        )}
      />,
    );
    expect(container.querySelector('.agenda-camada__linha svg')).not.toBeNull();
    expect(screen.getByText('10:00')).toBeInTheDocument();
    expect(screen.getByText('Carrossel')).toBeInTheDocument();
    expect(container.querySelector('.agenda-ev__dot')).toBeNull();
  });

  it('renders an all-day layer item without a time', () => {
    render(
      <ConteudoDoEvento
        arg={camada(
          'dayGridMonth',
          { camada: 'prazos', prazo: { estourado: false } },
          new Date(2026, 9, 6),
        )}
      />,
    );
    expect(screen.queryByText('00:00')).toBeNull();
    expect(screen.getByText('Carrossel')).toBeInTheDocument();
  });
});
