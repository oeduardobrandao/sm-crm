import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../dialog';

function renderDialog(hideClose?: boolean) {
  render(
    <Dialog open>
      <DialogContent hideClose={hideClose}>
        <DialogTitle>Titulo</DialogTitle>
        <DialogDescription>Descricao</DialogDescription>
      </DialogContent>
    </Dialog>,
  );
}

describe('DialogContent hideClose', () => {
  it('renders the X close button by default', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeTruthy();
  });

  it('omits the X close button when hideClose is set', () => {
    renderDialog(true);
    expect(screen.queryByRole('button', { name: 'Fechar' })).toBeNull();
  });
});
