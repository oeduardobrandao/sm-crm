import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { AdminFormSheet } from '../AdminFormSheet';
import { mockPhone } from '../../../__tests__/phone';

function Harness(props: { submitting?: boolean; canClose?: () => boolean; onSubmit?: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <MemoryRouter>
      <p>{open ? 'aberto' : 'fechado'}</p>
      <AdminFormSheet
        open={open}
        onOpenChange={setOpen}
        title="Editar: Pro"
        formId="plan-form"
        submitting={props.submitting}
        canClose={props.canClose}
      >
        <form
          id="plan-form"
          onSubmit={(e) => {
            e.preventDefault();
            props.onSubmit?.();
          }}
        >
          <label>
            Nome <input defaultValue="Pro" />
          </label>
        </form>
      </AdminFormSheet>
    </MemoryRouter>
  );
}

describe.each([
  ['desktop', false],
  ['phone', true],
])('AdminFormSheet (%s)', (_name, phone) => {
  let restore: (() => void) | null = null;
  afterEach(() => restore?.());
  const setup = () => {
    if (phone) restore = mockPhone();
  };

  it('the header submit submits the page form (one form, no nesting)', () => {
    setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    const dialog = screen.getByRole('dialog', { name: 'Editar: Pro' });
    expect(dialog.querySelectorAll('form')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('Cancelar closes', () => {
    setup();
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByText('fechado')).toBeInTheDocument();
  });

  it('while submitting, Cancelar and Escape do not close', () => {
    setup();
    render(<Harness submitting />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.getByText('aberto')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Salvar/ })).toBeDisabled();
  });

  it('canClose returning false keeps it open', () => {
    setup();
    render(<Harness canClose={() => false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByText('aberto')).toBeInTheDocument();
  });
});
