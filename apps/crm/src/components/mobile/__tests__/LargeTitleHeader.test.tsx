import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LargeTitleHeader, PhoneIconButton } from '../LargeTitleHeader';

describe('LargeTitleHeader', () => {
  it('renders the title as the page heading with subtitle and toolbar actions', () => {
    const onNew = vi.fn();
    render(
      <LargeTitleHeader
        title="Entregas"
        subtitle="24 fluxos ativos"
        trailing={
          <PhoneIconButton label="Novo" variant="ink" onClick={onNew}>
            <svg />
          </PhoneIconButton>
        }
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Entregas' })).toBeInTheDocument();
    expect(screen.getByText('24 fluxos ativos')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Novo' }));
    expect(onNew).toHaveBeenCalled();
  });

  it('omits the toolbar row when there are no actions and supports h2', () => {
    const { container } = render(<LargeTitleHeader title="Notificações" as="h2" />);
    expect(container.querySelector('.phone-large-title__bar')).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Notificações' })).toBeInTheDocument();
  });
});

describe('PhoneIconButton', () => {
  it('shows a decorative badge, caps it at 99+ and hides it at 0', () => {
    const { rerender } = render(
      <PhoneIconButton label="Notificações, 3 não lidas" badge={3}>
        <svg />
      </PhoneIconButton>,
    );
    const button = screen.getByRole('button', { name: 'Notificações, 3 não lidas' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button.querySelector('.phone-icon-button__badge')).toHaveTextContent('3');
    expect(button.querySelector('.phone-icon-button__badge')).toHaveAttribute(
      'aria-hidden',
      'true',
    );

    rerender(
      <PhoneIconButton label="Notificações" badge={250}>
        <svg />
      </PhoneIconButton>,
    );
    expect(screen.getByRole('button').querySelector('.phone-icon-button__badge')).toHaveTextContent(
      '99+',
    );

    rerender(
      <PhoneIconButton label="Notificações" badge={0}>
        <svg />
      </PhoneIconButton>,
    );
    expect(screen.getByRole('button').querySelector('.phone-icon-button__badge')).toBeNull();
  });
});
