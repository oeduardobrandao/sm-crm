import { render } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BuildPrefetch } from '../BuildPrefetch';

const cancel = vi.fn();
const prefetchBuildAssets = vi.fn(() => cancel);
let isAdmin = false;

vi.mock('@mesaas/app-lifecycle', () => ({
  prefetchBuildAssets: (...args: unknown[]) => prefetchBuildAssets(...args),
}));
vi.mock('../../context/AdminAuthContext', () => ({
  useAdminAuth: () => ({ isAdmin }),
}));

beforeEach(() => {
  cancel.mockClear();
  prefetchBuildAssets.mockClear();
  isAdmin = false;
});

describe('BuildPrefetch (admin)', () => {
  it('does nothing before the admin check passes', () => {
    render(<BuildPrefetch />);
    expect(prefetchBuildAssets).not.toHaveBeenCalled();
  });

  it('prefetches for a confirmed admin and cancels on unmount', () => {
    isAdmin = true;
    const { unmount } = render(<BuildPrefetch />);
    expect(prefetchBuildAssets).toHaveBeenCalledWith({ manifestUrl: '/admin/build-manifest.json' });
    unmount();
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
