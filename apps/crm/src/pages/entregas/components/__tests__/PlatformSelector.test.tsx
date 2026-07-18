import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { PlatformSelector } from '../PlatformSelector';
import { toast } from 'sonner';

const defaultProps = {
  tiktokFeatureEnabled: true,
  hasActiveTikTokAccount: true,
  onChange: vi.fn(),
};

describe('PlatformSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Visibility ──────────────────────────────────────────────

  it('renders nothing when feature_tiktok is off (hidden entirely, not just disabled)', () => {
    const { container } = render(
      <PlatformSelector
        value="instagram"
        tipo="feed"
        {...defaultProps}
        tiktokFeatureEnabled={false}
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders all three options when the feature is on', () => {
    render(<PlatformSelector value="instagram" tipo="feed" {...defaultProps} />);
    expect(screen.getByText('Instagram')).toBeTruthy();
    expect(screen.getByText('TikTok')).toBeTruthy();
    expect(screen.getByText('Ambas')).toBeTruthy();
  });

  // ─── Gating: tipo === 'stories' ─────────────────────────────

  it('disables TikTok and Ambas when tipo is stories, with the PT-BR tooltip reason', () => {
    render(<PlatformSelector value="instagram" tipo="stories" {...defaultProps} />);
    const tiktokBtn = screen.getByText('TikTok').closest('button')!;
    const ambasBtn = screen.getByText('Ambas').closest('button')!;
    expect(tiktokBtn.hasAttribute('disabled')).toBe(true);
    expect(ambasBtn.hasAttribute('disabled')).toBe(true);
    expect(tiktokBtn.closest('[title]')?.getAttribute('title')).toBe(
      'Stories não são suportados no TikTok',
    );
  });

  it('leaves Instagram enabled when tipo is stories', () => {
    render(<PlatformSelector value="instagram" tipo="stories" {...defaultProps} />);
    const igBtn = screen.getByText('Instagram').closest('button')!;
    expect(igBtn.hasAttribute('disabled')).toBe(false);
  });

  // ─── Gating: no active TikTok account ───────────────────────

  it('disables TikTok and Ambas when the client has no active TikTok account', () => {
    render(
      <PlatformSelector
        value="instagram"
        tipo="feed"
        {...defaultProps}
        hasActiveTikTokAccount={false}
      />,
    );
    const tiktokBtn = screen.getByText('TikTok').closest('button')!;
    const ambasBtn = screen.getByText('Ambas').closest('button')!;
    expect(tiktokBtn.hasAttribute('disabled')).toBe(true);
    expect(ambasBtn.hasAttribute('disabled')).toBe(true);
    expect(tiktokBtn.closest('[title]')?.getAttribute('title')).toBe(
      'Cliente sem conta TikTok ativa',
    );
  });

  it('does not disable TikTok/Ambas when tipo is not stories and the account is active', () => {
    render(<PlatformSelector value="instagram" tipo="feed" {...defaultProps} />);
    const tiktokBtn = screen.getByText('TikTok').closest('button')!;
    const ambasBtn = screen.getByText('Ambas').closest('button')!;
    expect(tiktokBtn.hasAttribute('disabled')).toBe(false);
    expect(ambasBtn.hasAttribute('disabled')).toBe(false);
  });

  // ─── Selection ───────────────────────────────────────────────

  it('calls onChange with the clicked platform when enabled', () => {
    const onChange = vi.fn();
    render(
      <PlatformSelector value="instagram" tipo="feed" {...defaultProps} onChange={onChange} />,
    );
    fireEvent.click(screen.getByText('TikTok'));
    expect(onChange).toHaveBeenCalledWith('tiktok');
  });

  it('never calls onChange for a disabled TikTok option (stories)', () => {
    const onChange = vi.fn();
    render(
      <PlatformSelector value="instagram" tipo="stories" {...defaultProps} onChange={onChange} />,
    );
    fireEvent.click(screen.getByText('TikTok'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('never calls onChange for a disabled Ambas option (no active account)', () => {
    const onChange = vi.fn();
    render(
      <PlatformSelector
        value="instagram"
        tipo="feed"
        {...defaultProps}
        hasActiveTikTokAccount={false}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText('Ambas'));
    expect(onChange).not.toHaveBeenCalled();
  });

  // ─── Auto-revert when tipo -> stories with platform already tiktok/both ──

  it('auto-reverts to instagram and shows a PT-BR toast when tipo is stories but value is tiktok', () => {
    const onChange = vi.fn();
    render(
      <PlatformSelector value="tiktok" tipo="stories" {...defaultProps} onChange={onChange} />,
    );
    expect(onChange).toHaveBeenCalledWith('instagram');
    expect(toast.info).toHaveBeenCalledWith(
      'Plataforma revertida para Instagram: Stories não são suportados no TikTok.',
    );
  });

  it('auto-reverts to instagram when tipo is stories but value is both', () => {
    const onChange = vi.fn();
    render(<PlatformSelector value="both" tipo="stories" {...defaultProps} onChange={onChange} />);
    expect(onChange).toHaveBeenCalledWith('instagram');
    expect(toast.info).toHaveBeenCalledTimes(1);
  });

  it('does not auto-revert or toast when tipo is stories and value is already instagram', () => {
    const onChange = vi.fn();
    render(
      <PlatformSelector value="instagram" tipo="stories" {...defaultProps} onChange={onChange} />,
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('does not auto-revert when tipo is not stories, even if value is tiktok', () => {
    const onChange = vi.fn();
    render(<PlatformSelector value="tiktok" tipo="reels" {...defaultProps} onChange={onChange} />);
    expect(onChange).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('does not re-fire the revert if the value prop has not yet caught up on re-render', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <PlatformSelector value="tiktok" tipo="stories" {...defaultProps} onChange={onChange} />,
    );
    expect(onChange).toHaveBeenCalledTimes(1);
    // Parent re-renders (e.g. unrelated query refetch) before the async update lands —
    // value prop is still stale 'tiktok'. Must not spam onChange/toast again.
    rerender(
      <PlatformSelector value="tiktok" tipo="stories" {...defaultProps} onChange={onChange} />,
    );
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledTimes(1);
  });
});
