import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { hasUnsavedWork } from '@mesaas/app-lifecycle';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../dialog';

function renderDirty(onConfirmClose: () => void) {
  return render(
    <Dialog open onOpenChange={() => {}}>
      <DialogContent confirmClose onConfirmClose={onConfirmClose}>
        <DialogHeader>
          <DialogTitle>Título</DialogTitle>
        </DialogHeader>
        <p>corpo</p>
      </DialogContent>
    </Dialog>,
  );
}

describe('DialogContent close confirmation', () => {
  it('X button opens the confirm dialog instead of closing', () => {
    const onConfirmClose = vi.fn();
    renderDirty(onConfirmClose);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(screen.getByText('Fechar sem salvar?')).toBeTruthy();
    expect(onConfirmClose).not.toHaveBeenCalled();
  });

  it('confirming from the X path calls onConfirmClose', () => {
    const onConfirmClose = vi.fn();
    renderDirty(onConfirmClose);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    fireEvent.click(screen.getByText('Fechar mesmo assim'));
    expect(onConfirmClose).toHaveBeenCalledTimes(1);
  });

  it('Escape opens the confirm dialog (regression guard)', () => {
    const onConfirmClose = vi.fn();
    renderDirty(onConfirmClose);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.getByText('Fechar sem salvar?')).toBeTruthy();
  });

  it('overlay pointerdown opens the confirm dialog (outside-interaction guard)', async () => {
    const onConfirmClose = vi.fn();
    renderDirty(onConfirmClose);
    // Radix's DismissableLayer attaches its outside-pointerdown listener inside a
    // setTimeout(0), so it isn't wired up until the next macrotask — await one tick
    // before dispatching (fallback path per task brief: drive via document.body).
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.pointerDown(document.body);
    expect(screen.getByText('Fechar sem salvar?')).toBeTruthy();
    expect(onConfirmClose).not.toHaveBeenCalled();
  });

  it('holds the unsaved-work registry while confirmClose is set', () => {
    const { unmount } = renderDirty(vi.fn());
    expect(hasUnsavedWork()).toBe(true);
    unmount();
    expect(hasUnsavedWork()).toBe(false);
  });

  it('does not hold the registry for a clean dialog', () => {
    render(
      <Dialog open onOpenChange={() => {}}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Título</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    );
    expect(hasUnsavedWork()).toBe(false);
  });
});
