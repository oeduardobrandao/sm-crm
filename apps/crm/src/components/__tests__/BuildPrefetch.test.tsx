import { render } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BuildPrefetch } from '../BuildPrefetch';

const cancel = vi.fn();
const prefetchBuildAssets = vi.fn(() => cancel);
let user: { id: string } | null = null;

vi.mock('@mesaas/app-lifecycle', () => ({
  prefetchBuildAssets: (...args: unknown[]) => prefetchBuildAssets(...args),
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user }),
}));

beforeEach(() => {
  cancel.mockClear();
  prefetchBuildAssets.mockClear();
  user = null;
});

describe('BuildPrefetch', () => {
  it('does nothing while signed out', () => {
    render(<BuildPrefetch />);
    expect(prefetchBuildAssets).not.toHaveBeenCalled();
  });

  it('prefetches once signed in and cancels on unmount', () => {
    user = { id: 'u1' };
    const { unmount } = render(<BuildPrefetch />);
    expect(prefetchBuildAssets).toHaveBeenCalledTimes(1);
    expect(prefetchBuildAssets).toHaveBeenCalledWith({ manifestUrl: '/build-manifest.json' });
    unmount();
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
