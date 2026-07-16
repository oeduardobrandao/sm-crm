import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
    },
  },
}));

vi.mock('../lib/api', () => ({
  verifyAdmin: vi.fn(),
}));

import { supabase } from '../lib/supabase';
import { verifyAdmin } from '../lib/api';
import { AdminAuthProvider } from '../context/AdminAuthContext';
import AdminProtectedRoute from '../layouts/AdminProtectedRoute';
import LoginPage from '../pages/LoginPage';

const mockedVerifyAdmin = vi.mocked(verifyAdmin);
const mockedAuth = vi.mocked(supabase.auth);

const ADMIN_USER = { id: 'admin-1', email: 'admin@mesaas.com.br' };

/** Resolvers for every in-flight verifyAdmin() call, in call order. */
let pendingChecks: Array<(result: { is_admin: boolean }) => void>;
/** The listener AdminAuthContext registered with supabase.auth.onAuthStateChange. */
let authListener: (event: string, session: unknown) => void;

beforeEach(() => {
  pendingChecks = [];

  mockedAuth.getSession.mockResolvedValue({ data: { session: null } } as never);
  mockedAuth.onAuthStateChange.mockImplementation((cb: never) => {
    authListener = cb as never;
    return { data: { subscription: { unsubscribe: vi.fn() } } } as never;
  });
  mockedAuth.signOut.mockResolvedValue({ error: null } as never);

  // Signing in emits SIGNED_IN, exactly like supabase-js does.
  mockedAuth.signInWithPassword.mockImplementation((async () => {
    authListener('SIGNED_IN', { user: ADMIN_USER });
    return { data: { user: ADMIN_USER }, error: null };
  }) as never);

  // Every admin check stays in flight until the test resolves it by hand.
  mockedVerifyAdmin.mockImplementation(
    () => new Promise<{ is_admin: boolean }>((resolve) => pendingChecks.push(resolve)),
  );
});

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/admin/login']}>
      <AdminAuthProvider>
        <Routes>
          <Route path="/admin/login" element={<LoginPage />} />
          <Route
            path="/admin"
            element={
              <AdminProtectedRoute>
                <div>Painel admin</div>
              </AdminProtectedRoute>
            }
          />
        </Routes>
      </AdminAuthProvider>
    </MemoryRouter>,
  );
}

async function submitLogin(container: HTMLElement) {
  fireEvent.change(container.querySelector('input[type="email"]')!, {
    target: { value: ADMIN_USER.email },
  });
  fireEvent.change(container.querySelector('input[type="password"]')!, {
    target: { value: 'correct-horse' },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /entrar/i }));
  });
}

describe('admin login flow', () => {
  // The reported bug: login worked only on the second attempt. Both the login page and the
  // auth context verify admin status independently, so whichever check is still in flight
  // when the login page navigates must not be read as "not an admin".
  it.each([
    { name: 'first check resolves first', order: (c: typeof pendingChecks) => c },
    { name: 'last check resolves first', order: (c: typeof pendingChecks) => [...c].reverse() },
  ])('reaches the admin panel on the first attempt when the $name', async ({ order }) => {
    const { container } = renderApp();
    await waitFor(() => expect(mockedAuth.getSession).toHaveBeenCalled());

    await submitLogin(container);
    await waitFor(() => expect(pendingChecks.length).toBeGreaterThan(0));

    // Resolve the in-flight admin checks one at a time, in the order under test.
    for (const resolve of order(pendingChecks)) {
      await act(async () => {
        resolve({ is_admin: true });
        await Promise.resolve();
      });
    }

    expect(await screen.findByText('Painel admin')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /entrar/i })).not.toBeInTheDocument();
  });

  it('re-checks admin status after a sign-out instead of reusing the old verdict', async () => {
    const { container } = renderApp();
    await waitFor(() => expect(mockedAuth.getSession).toHaveBeenCalled());

    await submitLogin(container);
    await waitFor(() => expect(pendingChecks.length).toBeGreaterThan(0));
    await act(async () => {
      pendingChecks.forEach((resolve) => resolve({ is_admin: true }));
      await Promise.resolve();
    });
    expect(await screen.findByText('Painel admin')).toBeInTheDocument();

    pendingChecks = [];
    await act(async () => {
      authListener('SIGNED_OUT', null);
      await Promise.resolve();
    });

    // Same user signs back in — their admin status must be verified again.
    await act(async () => {
      authListener('SIGNED_IN', { user: ADMIN_USER });
      await Promise.resolve();
    });
    await waitFor(() => expect(pendingChecks.length).toBeGreaterThan(0));
  });

  it('keeps a non-admin on the login page with an error', async () => {
    const { container } = renderApp();
    await waitFor(() => expect(mockedAuth.getSession).toHaveBeenCalled());

    await submitLogin(container);
    await waitFor(() => expect(pendingChecks.length).toBeGreaterThan(0));

    await act(async () => {
      pendingChecks.forEach((resolve) => resolve({ is_admin: false }));
      await Promise.resolve();
    });

    expect(await screen.findByText('Acesso não autorizado.')).toBeInTheDocument();
    expect(screen.queryByText('Painel admin')).not.toBeInTheDocument();
  });
});
