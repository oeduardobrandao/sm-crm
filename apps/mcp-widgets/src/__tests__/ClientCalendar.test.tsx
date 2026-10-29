import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import calendar from '../__fixtures__/client_calendar.json';
import { fakeHost } from './fakeHost';

describe('ClientCalendar', () => {
  it('renders three weeks and "Sem post" on the gap days only', () => {
    const { container } = render(<App host={fakeHost(calendar)} />);
    expect(container.querySelectorAll('.mw-cal-week:not(.mw-cal-head)')).toHaveLength(3);
    const gapCells = container.querySelectorAll(
      '[data-date="2026-11-11"], [data-date="2026-11-18"]',
    );
    gapCells.forEach((c) => expect(c).toHaveTextContent('Sem post'));
    expect(screen.getAllByText('Sem post')).toHaveLength(2);
  });

  it('header names the range and the summary counts', () => {
    render(<App host={fakeHost(calendar)} />);
    expect(screen.getByText('Dra. Marina Arrais · 2 a 22 de novembro')).toBeInTheDocument();
    expect(
      screen.getByText('7 posts · 2 aguardando aprovação · 2 dias de costume sem post'),
    ).toBeInTheDocument();
  });

  it('"Sugerir posts para os dias vazios" sends a message naming the gap dates', async () => {
    const host = fakeHost(calendar);
    render(<App host={host} />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Sugerir posts para os dias vazios' }),
    );
    expect(host.sendMessage).toHaveBeenCalledWith(
      'Sugira posts para Dra. Marina Arrais nos dias de costume sem post: quarta, 11/11 e quarta, 18/11.',
    );
  });

  it('"Abrir calendário no Mesaas" opens open_url', async () => {
    const host = fakeHost(calendar);
    render(<App host={host} />);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir calendário no Mesaas' }));
    expect(host.openLink).toHaveBeenCalledWith(calendar.open_url);
  });

  it.each([
    ['another origin', 'https://evil.example/entregas'],
    ['a look-alike host', 'https://www.mesaas.com.br.evil.example/x'],
    ['a script url', 'javascript:alert(1)'],
  ])('open_url on %s is not opened and shows the link message', async (_n, url) => {
    const host = fakeHost({ ...calendar, open_url: url });
    render(<App host={host} />);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir calendário no Mesaas' }));
    expect(host.openLink).not.toHaveBeenCalled();
    expect(
      screen.getByText('O chat não abriu o link. Abra o Mesaas no navegador.'),
    ).toBeInTheDocument();
  });

  it('no gaps: no suggest button and no "Sem post"', () => {
    const quiet = {
      ...calendar,
      usual_weekdays: [],
      days: calendar.days.map((d) => ({ ...d, gap: false })),
    };
    render(<App host={fakeHost(quiet)} />);
    expect(screen.queryByText('Sem post')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sugerir posts para os dias vazios' })).toBeNull();
  });
});
