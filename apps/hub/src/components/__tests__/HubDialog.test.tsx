import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HubDialog } from '../ui/HubDialog';

afterEach(() => {
  document.querySelector('.hub-root')?.remove();
});

describe('HubDialog', () => {
  it('portals into .hub-root when it exists, with an sr-only title', () => {
    const root = document.createElement('div');
    root.className = 'hub-root';
    document.body.appendChild(root);
    render(
      <HubDialog open onRequestClose={vi.fn()} title="Título do post">
        <p>Conteúdo</p>
      </HubDialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Título do post' });
    expect(root.contains(dialog)).toBe(true);
    expect(screen.getByText('Conteúdo')).toBeInTheDocument();
  });

  it('falls back to document.body without a .hub-root', () => {
    render(
      <HubDialog open onRequestClose={vi.fn()} title="T">
        <p>x</p>
      </HubDialog>,
    );
    expect(document.body.contains(screen.getByRole('dialog'))).toBe(true);
  });

  it('reports escape and does not close by itself', () => {
    const onRequestClose = vi.fn();
    render(
      <HubDialog open onRequestClose={onRequestClose} title="T">
        <p>x</p>
      </HubDialog>,
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onRequestClose).toHaveBeenCalledWith('escape');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('reports outside for a click on the scrim but not on content', () => {
    const onRequestClose = vi.fn();
    render(
      <HubDialog open onRequestClose={onRequestClose} title="T">
        <p>x</p>
      </HubDialog>,
    );
    fireEvent.click(screen.getByText('x'));
    expect(onRequestClose).not.toHaveBeenCalled();
    const scrim = screen.getByTestId('hub-dialog-scrim');
    fireEvent.pointerDown(scrim);
    fireEvent.click(scrim);
    expect(onRequestClose).toHaveBeenCalledWith('outside');
  });

  it('does not close when the press started inside the card and the click lands on the scrim', () => {
    const onRequestClose = vi.fn();
    render(
      <HubDialog open onRequestClose={onRequestClose} title="T">
        <p>x</p>
      </HubDialog>,
    );
    // A text-selection drag: pointerdown on the caption, release over the scrim. The
    // resulting click is dispatched on the common ancestor, the scrim wrapper.
    fireEvent.pointerDown(screen.getByText('x'));
    fireEvent.click(screen.getByTestId('hub-dialog-scrim'));
    expect(onRequestClose).not.toHaveBeenCalled();
  });

  it('closes on a press and click that both happen on the scrim', () => {
    const onRequestClose = vi.fn();
    render(
      <HubDialog open onRequestClose={onRequestClose} title="T">
        <p>x</p>
      </HubDialog>,
    );
    const scrim = screen.getByTestId('hub-dialog-scrim');
    fireEvent.pointerDown(scrim);
    fireEvent.click(scrim);
    expect(onRequestClose).toHaveBeenCalledTimes(1);
    expect(onRequestClose).toHaveBeenCalledWith('outside');
  });

  it('renders nothing when closed', () => {
    render(
      <HubDialog open={false} onRequestClose={vi.fn()} title="T">
        <p>x</p>
      </HubDialog>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
