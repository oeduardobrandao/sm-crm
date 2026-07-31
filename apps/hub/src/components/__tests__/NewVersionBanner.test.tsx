import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NewVersionBanner } from '../NewVersionBanner';

const stop = vi.fn();
let fire: (() => void) | undefined;

vi.mock('@mesaas/app-lifecycle', () => ({
  watchForNewVersion: ({ onNewVersion }: { onNewVersion: () => void }) => {
    fire = onNewVersion;
    return stop;
  },
}));

beforeEach(() => {
  stop.mockClear();
  fire = undefined;
});

describe('NewVersionBanner', () => {
  it('stays hidden until a new deploy is detected', () => {
    render(<NewVersionBanner />);
    expect(screen.queryByText('Nova versão disponível')).toBeNull();
  });

  it('shows the notice and reloads when the action is used', () => {
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    });

    render(<NewVersionBanner />);
    act(() => fire?.());

    expect(screen.getByText('Nova versão disponível')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('stops watching when unmounted', () => {
    render(<NewVersionBanner />).unmount();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
