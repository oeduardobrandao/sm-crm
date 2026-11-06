import { StrictMode, type ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRecordBlogView } from '../useRecordBlogView';

const ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/blog-view`;

let fetchMock: ReturnType<typeof vi.fn>;

function setPage(opts: { hostname?: string; search?: string; visible?: boolean }) {
  vi.stubGlobal('location', {
    hostname: opts.hostname ?? 'www.mesaas.com.br',
    search: opts.search ?? '',
  });
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (opts.visible === false ? 'hidden' : 'visible'),
  });
}

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  setPage({});
});

afterEach(() => {
  vi.unstubAllGlobals();
  // jsdom defines webdriver on Navigator.prototype; drop only what a test set on the instance.
  delete (navigator as { webdriver?: boolean }).webdriver;
  delete (document as { visibilityState?: string }).visibilityState;
});

describe('useRecordBlogView', () => {
  it('posts the slug once on the production host', () => {
    renderHook(() => useRecordBlogView('x'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(ENDPOINT, {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'x' }),
    });
  });

  it('still sends one call under StrictMode double mount', () => {
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    renderHook(() => useRecordBlogView('x'), { wrapper });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does nothing without a slug', () => {
    renderHook(() => useRecordBlogView(null));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does nothing off the production host', () => {
    setPage({ hostname: 'localhost' });
    renderHook(() => useRecordBlogView('x'));
    setPage({ hostname: 'staging.mesaas.com.br' });
    renderHook(() => useRecordBlogView('x'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does nothing for an admin preview (?ref=admin)', () => {
    setPage({ search: '?utm=a&ref=admin' });
    renderHook(() => useRecordBlogView('x'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does nothing for automated browsers', () => {
    Object.defineProperty(navigator, 'webdriver', { configurable: true, value: true });
    renderHook(() => useRecordBlogView('x'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('waits for the tab to become visible, then sends once', () => {
    setPage({ visible: false });
    renderHook(() => useRecordBlogView('x'));
    expect(fetchMock).not.toHaveBeenCalled();

    setPage({ visible: true });
    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops waiting when unmounted while hidden', () => {
    setPage({ visible: false });
    const { unmount } = renderHook(() => useRecordBlogView('x'));
    unmount();
    setPage({ visible: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends again when the slug changes', () => {
    const { rerender } = renderHook(({ slug }) => useRecordBlogView(slug), {
      initialProps: { slug: 'x' as string | null },
    });
    rerender({ slug: 'x' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    rerender({ slug: 'y' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(
      ENDPOINT,
      expect.objectContaining({ body: JSON.stringify({ slug: 'y' }) }),
    );
  });

  it('swallows a rejected fetch', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    expect(() => renderHook(() => useRecordBlogView('x'))).not.toThrow();
    await Promise.resolve();
  });

  it('swallows a synchronous fetch throw', () => {
    fetchMock.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(() => renderHook(() => useRecordBlogView('x'))).not.toThrow();
  });
});
