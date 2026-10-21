import { describe, expect, it, vi } from 'vitest';
import { render, renderHook, screen, fireEvent } from '@testing-library/react';
import { PlatformChips, usePlatformChipsVisible } from '../PlatformChips';

const limitsFeatures = vi.hoisted(() => ({
  current: { feature_tiktok: false } as Record<string, boolean> | undefined,
}));
vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({ features: limitsFeatures.current }),
}));

describe('PlatformChips', () => {
  it('toggles platforms and keeps order from the registry', () => {
    const onChange = vi.fn();
    render(<PlatformChips value={['instagram']} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Geral/ }));
    expect(onChange).toHaveBeenCalledWith(['instagram', 'geral']);
  });

  it('never emits an empty list', () => {
    const onChange = vi.fn();
    render(<PlatformChips value={['geral']} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Geral/ }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('Escolha pelo menos uma plataforma.')).toBeInTheDocument();
  });

  it('hides TikTok without the plan flag, shows YouTube as coming soon', () => {
    render(<PlatformChips value={['instagram']} onChange={() => {}} />);
    expect(screen.queryByRole('button', { name: /TikTok/ })).toBeNull();
    const yt = screen.getByRole('button', { name: /YouTube/ });
    expect(yt).toBeDisabled();
    expect(yt).toHaveTextContent('em breve');
  });

  it('keeps TikTok visible when the value already has it', () => {
    render(<PlatformChips value={['tiktok']} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /TikTok/ })).toBeInTheDocument();
  });
});

describe('usePlatformChipsVisible', () => {
  const visible = (features: Record<string, boolean> | undefined, value?: string[]) => {
    limitsFeatures.current = features;
    try {
      return renderHook(() =>
        usePlatformChipsVisible(value as Parameters<typeof usePlatformChipsVisible>[0]),
      ).result.current;
    } finally {
      limitsFeatures.current = { feature_tiktok: false };
    }
  };

  it('is hidden without feature_multiplatform for the {instagram} default', () => {
    expect(visible({}, ['instagram'])).toBe(false);
    expect(visible({ feature_multiplatform: false }, ['instagram'])).toBe(false);
  });

  it('is hidden while the limits are loading', () => {
    expect(visible(undefined, ['instagram'])).toBe(false);
  });

  it('is visible with feature_multiplatform', () => {
    expect(visible({ feature_multiplatform: true }, ['instagram'])).toBe(true);
  });

  it('stays visible without the flag when the value is no longer {instagram}', () => {
    expect(visible({}, ['instagram', 'geral'])).toBe(true);
    expect(visible({}, ['geral'])).toBe(true);
  });
});
