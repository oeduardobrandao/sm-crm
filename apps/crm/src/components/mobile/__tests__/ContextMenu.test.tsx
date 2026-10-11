import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextMenu } from '../ContextMenu';
import { LONG_PRESS_MS } from '../useLongPress';
import { installPointerEvent, pointerDown, pointerMove, pointerUp } from './pointer';

beforeAll(installPointerEvent);

function renderMenu({
  onOpenCard = vi.fn(),
  onAdvance = vi.fn(),
  onDelete = vi.fn(),
}: { onOpenCard?: () => void; onAdvance?: () => void; onDelete?: () => void } = {}) {
  render(
    <MemoryRouter>
      <ContextMenu
        label="Ações do fluxo"
        preview={<div>Prévia do card</div>}
        sections={[
          [
            { label: 'Concluir etapa e avançar', onSelect: onAdvance },
            { label: 'Voltar etapa', onSelect: () => {} },
          ],
          [{ label: 'Excluir', onSelect: onDelete, destructive: true }],
        ]}
      >
        {({ triggerProps }) => (
          <article>
            <button type="button" onClick={onOpenCard}>
              Posts de outubro
            </button>
            <button {...triggerProps} aria-label="Mais ações">
              …
            </button>
          </article>
        )}
      </ContextMenu>
    </MemoryRouter>,
  );
  return { onOpenCard, onAdvance, onDelete };
}

const card = () => screen.getByRole('button', { name: 'Posts de outubro' });

describe('ContextMenu', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens after a ~450ms hold, marks the target while holding, and swallows the click that follows', () => {
    const { onOpenCard } = renderMenu();
    const target = card();
    pointerDown(target, { x: 10, y: 10 });
    expect(document.querySelector('.phone-hold-target')).toHaveAttribute('data-holding', 'true');
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS - 50);
    });
    expect(screen.queryByRole('menu')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(screen.getByRole('menu', { name: 'Ações do fluxo' })).toBeInTheDocument();
    expect(document.querySelector('.phone-hold-target')).not.toHaveAttribute('data-holding');
    expect(screen.getByText('Prévia do card').closest('[aria-hidden="true"]')).not.toBeNull();

    pointerUp(target, { x: 10, y: 10 });
    fireEvent.click(target);
    expect(onOpenCard).not.toHaveBeenCalled();
  });

  it('a move past 8px cancels the hold so the page can scroll, and a plain tap still taps', () => {
    const { onOpenCard } = renderMenu();
    const target = card();
    pointerDown(target, { x: 10, y: 10 });
    pointerMove(target, { x: 10, y: 30 });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS + 100);
    });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.querySelector('.phone-hold-target')).not.toHaveAttribute('data-holding');

    pointerDown(target, { x: 10, y: 10 });
    pointerUp(target, { x: 10, y: 10 });
    fireEvent.click(target);
    expect(onOpenCard).toHaveBeenCalledTimes(1);
  });

  it('opens on right-click and on Shift+F10', () => {
    renderMenu();
    fireEvent.contextMenu(card());
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    act(() => {
      vi.runAllTimers();
    });
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.keyDown(card(), { key: 'F10', shiftKey: true });
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('opens from the explicit trigger, reflects aria-expanded and runs the chosen action', () => {
    const { onAdvance } = renderMenu();
    const trigger = screen.getByRole('button', { name: 'Mais ações' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Concluir etapa e avançar' }));
    expect(onAdvance).toHaveBeenCalledTimes(1);
    act(() => {
      vi.runAllTimers();
    });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('moves between items with the arrow keys and separates groups', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Mais ações' }));
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(3);
    expect(screen.getByRole('separator')).toBeInTheDocument();
    expect(items[2]).toHaveClass('phone-context-menu__item--destructive');
    items[0].focus();
    fireEvent.keyDown(items[0], { key: 'ArrowDown' });
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(items[1], { key: 'End' });
    expect(items[2]).toHaveFocus();
    fireEvent.keyDown(items[2], { key: 'ArrowDown' });
    expect(items[0]).toHaveFocus();
  });
});

describe('ContextMenu focus return', () => {
  it('returns focus to the explicit trigger on close', async () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'Mais ações' });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});

describe('ContextMenu immediate actions', () => {
  it('runs an `immediate` action inside the tap and closes the menu', async () => {
    const onOpenLink = vi.fn();
    render(
      <MemoryRouter>
        <ContextMenu
          label="Ações do cliente"
          sections={[[{ label: 'Abrir no Notion', onSelect: onOpenLink, immediate: true }]]}
        >
          {({ triggerProps }) => (
            <button {...triggerProps} aria-label="Mais ações">
              …
            </button>
          )}
        </ContextMenu>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Mais ações' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Abrir no Notion' }));
    expect(onOpenLink).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });
});
