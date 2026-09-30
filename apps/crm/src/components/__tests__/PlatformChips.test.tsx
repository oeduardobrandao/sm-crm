import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlatformChips } from '../PlatformChips';

vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({ features: { feature_tiktok: false } }),
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
