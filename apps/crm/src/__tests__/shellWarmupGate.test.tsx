import { afterEach, describe, expect, it, vi } from 'vitest';

// App.tsx warms the ProtectedRoute chunk at module scope for signed-in visitors. That chunk
// carries the shell CSS and the Phosphor icons, so the warm-up must only fire on the app shell
// (app.html, the one page with a noindex robots meta), never on a prerendered public page.
const loads = { protectedRoute: 0 };

vi.mock('../context/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => ({ user: null }),
}));

const SESSION_KEY = 'sb-abcdefghijklmnop-auth-token';

async function evaluateApp({ session, robots }: { session: boolean; robots: string | null }) {
  vi.resetModules();
  loads.protectedRoute = 0;
  // doMock after the reset so every evaluation gets a fresh factory that counts its own load.
  vi.doMock('../components/layout/ProtectedRoute', () => {
    loads.protectedRoute += 1;
    return { default: ({ children }: { children: React.ReactNode }) => <>{children}</> };
  });
  if (session) localStorage.setItem(SESSION_KEY, '{}');
  if (robots !== null) {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'robots');
    meta.setAttribute('content', robots);
    document.head.appendChild(meta);
  }
  await import('../App');
  // The warm-up is a fire-and-forget dynamic import; let it settle.
  await new Promise((r) => setTimeout(r, 50));
  return loads.protectedRoute;
}

describe('ProtectedRoute warm-up gate', () => {
  afterEach(() => {
    localStorage.clear();
    document.head.querySelectorAll('meta[name="robots"]').forEach((m) => m.remove());
  });

  it('warms the shell chunk on app.html for a stored session', async () => {
    await evaluateApp({ session: true, robots: 'noindex, nofollow' });
    await vi.waitFor(() => expect(loads.protectedRoute).toBe(1));
  });

  it('does not warm it on a prerendered public page, even signed in', async () => {
    expect(
      await evaluateApp({ session: true, robots: 'index, follow, max-image-preview:large' }),
    ).toBe(0);
  });

  it('does not warm it without a robots meta (dev index.html)', async () => {
    expect(await evaluateApp({ session: true, robots: null })).toBe(0);
  });

  it('does not warm it on app.html without a session', async () => {
    expect(await evaluateApp({ session: false, robots: 'noindex, nofollow' })).toBe(0);
  });
});
