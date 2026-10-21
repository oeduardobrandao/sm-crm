import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Sheet, SheetContent, SheetTitle } from '../sheet';

function renderSheet(side: 'right' | 'bottom') {
  render(
    <Sheet open>
      <SheetContent side={side} data-testid="sheet-content" aria-describedby={undefined}>
        <SheetTitle>Detalhes</SheetTitle>
      </SheetContent>
    </Sheet>,
  );
}

describe('SheetContent', () => {
  it('keeps side-sheet content and its close button below the top safe area', () => {
    renderSheet('right');

    const contentPaddingTop = screen.getByTestId('sheet-content').style.paddingTop;
    const closeTop = screen.getByRole('button', { name: 'Close' }).style.top;

    expect(contentPaddingTop).toContain('1.5rem');
    expect(contentPaddingTop).toContain('safe-area-inset-top');
    expect(closeTop).toContain('1rem');
    expect(closeTop).toContain('safe-area-inset-top');
  });

  it('does not add top safe-area offsets to bottom sheets', () => {
    renderSheet('bottom');

    expect(screen.getByTestId('sheet-content').style.paddingTop).toBe('');
    expect(screen.getByRole('button', { name: 'Close' }).style.top).toBe('');
  });
});
