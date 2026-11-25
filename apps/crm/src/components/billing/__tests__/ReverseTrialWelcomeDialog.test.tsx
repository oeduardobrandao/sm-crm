import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReverseTrialWelcomeDialog } from '../ReverseTrialWelcomeDialog';

afterEach(() => {
  (window as unknown as { Capacitor?: unknown }).Capacitor = undefined;
});

describe('ReverseTrialWelcomeDialog', () => {
  it('shows the 14-day copy with the São Paulo end date and closes', async () => {
    const onClose = vi.fn();
    render(<ReverseTrialWelcomeDialog endsAt="2026-12-08T17:00:00Z" onClose={onClose} />);
    expect(screen.getByText('Seu workspace está no Pro por 14 dias')).toBeInTheDocument();
    expect(screen.getByText(/Até 8 de dezembro/)).toBeInTheDocument();
    expect(screen.getByText('Sem cartão. No fim, você escolhe se continua.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Começar a usar' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders nothing without an end date', () => {
    render(<ReverseTrialWelcomeDialog endsAt={null} onClose={() => {}} />);
    expect(screen.queryByText('Seu workspace está no Pro por 14 dias')).toBeNull();
  });

  it('is text only inside the iOS app', () => {
    (window as unknown as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    render(<ReverseTrialWelcomeDialog endsAt="2026-12-08T17:00:00Z" onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Entendi' })).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
