import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CrmPinLayer } from '../CrmPinLayer';
import { makeNote } from './fixtures';

function mockBox(width: number, height: number) {
  return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    width,
    height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
}

describe('CrmPinLayer', () => {
  beforeEach(() => {
    mockBox(400, 400);
  });
  afterEach(() => vi.restoreAllMocks());

  it('numbers pins per link and places them inside the contained rect', () => {
    render(
      <CrmPinLayer
        linkId={5}
        natural={{ w: 1000, h: 500 }}
        notes={[
          makeNote({ id: 1, x: 0.5, y: 0.5, created_at: '2026-10-22T10:00:00Z' }),
          makeNote({ id: 2, x: 0, y: 0, created_at: '2026-10-22T10:05:00Z' }),
          makeNote({ id: 3, x: 0.5, y: 0.5, current_link_id: 6 }),
        ]}
      />,
    );
    const first = screen.getByLabelText(/^Ponto 1:/).closest('.crm-pin-anchor')!;
    const second = screen.getByLabelText(/^Ponto 2:/).closest('.crm-pin-anchor')!;
    // 1000x500 in a 400x400 box: rendered 400x200 starting at top 100.
    expect(first).toHaveStyle({ left: '50%', top: '50%' });
    expect(second).toHaveStyle({ left: '0%', top: '25%' });
    expect(screen.queryAllByLabelText(/Ponto/)).toHaveLength(2);
  });

  it('draws resolved and internal pins distinctly', () => {
    render(
      <CrmPinLayer
        linkId={5}
        natural={{ w: 400, h: 400 }}
        notes={[
          makeNote({ id: 1, x: 0.1, y: 0.1, status: 'resolved' }),
          makeNote({
            id: 2,
            x: 0.2,
            y: 0.2,
            visibility: 'internal',
            author_kind: 'team',
            created_at: '2026-10-22T11:00:00Z',
          }),
        ]}
      />,
    );
    expect(screen.getByLabelText(/^Ponto 1:/)).toHaveAttribute('data-state', 'resolved');
    const internal = screen.getByLabelText(/^Interno 1:/);
    expect(internal).toHaveAttribute('data-visibility', 'internal');
  });

  it('skips previous-version notes and notes without a spot', () => {
    render(
      <CrmPinLayer
        linkId={5}
        natural={{ w: 400, h: 400 }}
        notes={[
          makeNote({ id: 1, x: 0.1, y: 0.1, is_previous_version: true }),
          makeNote({ id: 2, x: null, y: null }),
        ]}
      />,
    );
    expect(screen.queryAllByLabelText(/Ponto/)).toHaveLength(0);
  });

  it('shows a video pin only near its moment; null moment always shows', () => {
    const notes = [
      makeNote({ id: 1, media_kind: 'video', t_seconds: 10, x: 0.3, y: 0.3 }),
      makeNote({
        id: 2,
        media_kind: 'video',
        t_seconds: null,
        x: 0.6,
        y: 0.6,
        created_at: '2026-10-22T10:30:00Z',
      }),
    ];
    const { rerender } = render(
      <CrmPinLayer linkId={5} natural={{ w: 400, h: 400 }} notes={notes} currentTime={10.5} />,
    );
    expect(screen.queryAllByLabelText(/Ponto/)).toHaveLength(2);
    rerender(
      <CrmPinLayer linkId={5} natural={{ w: 400, h: 400 }} notes={notes} currentTime={30} />,
    );
    expect(screen.queryAllByLabelText(/Ponto/)).toHaveLength(1);
    expect(screen.getByLabelText(/^Ponto 2:/)).toBeInTheDocument();
  });

  it('reports a placement inside the rendered media and ignores the letterbox', () => {
    const onPlace = vi.fn();
    render(
      <CrmPinLayer linkId={5} natural={{ w: 1000, h: 500 }} notes={[]} placing onPlace={onPlace} />,
    );
    const layer = screen.getByTestId('crm-pin-layer');
    fireEvent.click(layer, { clientX: 200, clientY: 200 });
    expect(onPlace).toHaveBeenCalledWith({ x: 0.5, y: 0.5 });
    onPlace.mockClear();
    fireEvent.click(layer, { clientX: 200, clientY: 50 });
    expect(onPlace).not.toHaveBeenCalled();
  });

  it('does not capture clicks when not placing', () => {
    render(<CrmPinLayer linkId={5} natural={{ w: 400, h: 400 }} notes={[]} />);
    expect(screen.getByTestId('crm-pin-layer')).toHaveClass('pointer-events-none');
  });

  it('numbers client pins on their own: an internal pin never shifts them', () => {
    render(
      <CrmPinLayer
        linkId={5}
        natural={{ w: 400, h: 400 }}
        notes={[
          makeNote({ id: 1, x: 0.1, y: 0.1, created_at: '2026-10-22T10:00:00Z' }),
          makeNote({
            id: 2,
            x: 0.2,
            y: 0.2,
            visibility: 'internal',
            author_kind: 'team',
            created_at: '2026-10-22T10:05:00Z',
          }),
          makeNote({ id: 3, x: 0.3, y: 0.3, created_at: '2026-10-22T10:10:00Z' }),
          makeNote({
            id: 4,
            x: 0.4,
            y: 0.4,
            visibility: 'internal',
            author_kind: 'team',
            created_at: '2026-10-22T10:15:00Z',
          }),
        ]}
      />,
    );
    expect(screen.getByLabelText(/^Ponto 1:/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Ponto 2:/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Interno 1:/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Interno 2:/)).toBeInTheDocument();
  });

  it('pins are buttons; clicking one opens its details with author and time', () => {
    render(
      <CrmPinLayer
        linkId={5}
        natural={{ w: 400, h: 400 }}
        authors={{ clientName: 'Maria', membros: [], workspaceUsers: [] }}
        notes={[makeNote({ id: 1, x: 0.5, y: 0.5, body: 'Trocar a cor' })]}
      />,
    );
    expect(screen.queryByRole('group', { name: 'Detalhes da nota' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Ponto 1:/ }));
    const details = screen.getByRole('group', { name: 'Detalhes da nota' });
    expect(details).toHaveTextContent('Trocar a cor');
    expect(details).toHaveTextContent('Maria');
    expect(details).toHaveTextContent('Em aberto');
  });

  it('the details resolve and reopen through onStatus, internal and client alike', async () => {
    const onStatus = vi.fn().mockResolvedValue(undefined);
    render(
      <CrmPinLayer
        linkId={5}
        natural={{ w: 400, h: 400 }}
        onStatus={onStatus}
        notes={[
          makeNote({ id: 1, x: 0.5, y: 0.5 }),
          makeNote({
            id: 2,
            x: 0.2,
            y: 0.2,
            status: 'resolved',
            visibility: 'internal',
            author_kind: 'team',
            created_at: '2026-10-22T11:00:00Z',
          }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Ponto 1:/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como resolvido' }));
    expect(onStatus).toHaveBeenCalledWith([1], 'resolved');
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'Detalhes da nota' })).not.toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /^Interno 1:/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reabrir' }));
    expect(onStatus).toHaveBeenCalledWith([2], 'open');
  });

  it('Escape closes the details without leaving the dialog', () => {
    render(
      <CrmPinLayer
        linkId={5}
        natural={{ w: 400, h: 400 }}
        notes={[makeNote({ id: 1, x: 0.5, y: 0.5 })]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Ponto 1:/ }));
    fireEvent.keyDown(screen.getByRole('group', { name: 'Detalhes da nota' }), { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Detalhes da nota' })).not.toBeInTheDocument();
  });
});
