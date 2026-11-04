import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlatformActions } from '../components/PlatformActions';

afterEach(() => cleanup());

describe('PlatformActions', () => {
  it('labels the disconnect "Desconectar" by default (TikTok keeps it)', async () => {
    const onDisconnect = vi.fn();
    render(<PlatformActions onSync={() => {}} syncing={false} onDisconnect={onDisconnect} />);
    const button = screen.getByRole('button', { name: 'Desconectar' });
    await userEvent.click(button);
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it('uses disconnectLabel when given', () => {
    render(
      <PlatformActions
        onSync={() => {}}
        syncing={false}
        onDisconnect={() => {}}
        disconnectLabel="Desconectar deste cliente"
      />,
    );
    expect(screen.getByRole('button', { name: 'Desconectar deste cliente' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Desconectar' })).toBeNull();
  });
});
