import { fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseQueryMock } from '../../../../../test/shared/supabaseMock';

type SessionUser = { id: string } | null;

function createMockClient(initialUser: SessionUser = { id: 'user-1' }) {
  const queryMock = createSupabaseQueryMock();
  let sessionUser = initialUser;
  let sessionError: unknown = null;

  const auth = {
    getSession: vi.fn(async () => ({
      data: {
        session: sessionUser ? { user: sessionUser } : null,
      },
      error: sessionError,
    })),
    signInWithPassword: vi.fn(async (payload: unknown) => ({ data: { session: sessionUser }, error: null, payload })),
    signUp: vi.fn(async (payload: unknown) => ({ data: { user: sessionUser }, error: null, payload })),
    resetPasswordForEmail: vi.fn(async (email: string, options: unknown) => ({ data: {}, error: null, email, options })),
    signOut: vi.fn(async () => {
      sessionUser = null;
      return { error: null };
    }),
  };

  const client = {
    from: (table: string) => queryMock.from(table),
    auth,
  };

  return {
    auth,
    client,
    queryMock,
    setSessionUser(user: SessionUser) {
      sessionUser = user;
    },
    setSessionError(error: unknown) {
      sessionError = error;
    },
  };
}

async function loadSupabaseModule(initialUser: SessionUser = { id: 'user-1' }) {
  vi.resetModules();
  const mock = createMockClient(initialUser);

  vi.doMock('@supabase/supabase-js', () => ({
    createClient: vi.fn(() => mock.client),
  }));

  const module = await import('../supabase');

  return {
    ...mock,
    module,
  };
}

function mountSidebarFixture() {
  document.body.innerHTML = `
    <div class="sidebar">
      <div class="avatar"></div>
      <div class="user-name"></div>
    </div>
    <div id="mobile-avatar"></div>
    <div id="mobile-user-name"></div>
    <div id="workspace-switcher"></div>
    <div id="workspace-list"></div>
  `;
}

describe('supabase helpers', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns the authenticated user from the current session', async () => {
    const { module } = await loadSupabaseModule({ id: 'user-77' });

    await expect(module.getCurrentUser()).resolves.toEqual({ id: 'user-77' });
  });

  it('returns null and warns when fetching the session fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { module, setSessionError } = await loadSupabaseModule();
    setSessionError({ message: 'session down' });

    await expect(module.getCurrentUser()).resolves.toBeNull();
    expect(warnSpy).toHaveBeenCalledWith('getSession error:', { message: 'session down' });
  });

  it('caches the current profile until a forced refresh is requested', async () => {
    const { module, queryMock } = await loadSupabaseModule({ id: 'user-1' });

    queryMock.queue(
      'profiles',
      'select',
      {
        data: { id: 'user-1', nome: 'Ana Silva', role: 'owner' },
        error: null,
      },
      {
        data: { id: 'user-1', nome: 'Ana Souza', role: 'owner' },
        error: null,
      },
    );

    await expect(module.getCurrentProfile()).resolves.toMatchObject({ nome: 'Ana Silva' });
    await expect(module.getCurrentProfile()).resolves.toMatchObject({ nome: 'Ana Silva' });
    expect(queryMock.calls.filter((call) => call.table === 'profiles' && call.operation === 'select')).toHaveLength(1);

    await expect(module.getCurrentProfile(true)).resolves.toMatchObject({ nome: 'Ana Souza' });
    expect(queryMock.calls.filter((call) => call.table === 'profiles' && call.operation === 'select')).toHaveLength(2);
  });

  it('returns null when the current profile cannot be loaded', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { module, queryMock } = await loadSupabaseModule({ id: 'user-1' });

    queryMock.queue('profiles', 'select', {
      data: null,
      error: { message: 'boom' },
    });

    await expect(module.getCurrentProfile()).resolves.toBeNull();
    expect(warnSpy).toHaveBeenCalledWith('getCurrentProfile error:', { message: 'boom' });
  });

  it('updates the sidebar identity and hides the switcher for a single workspace', async () => {
    const { module, queryMock } = await loadSupabaseModule({ id: 'user-1' });
    mountSidebarFixture();

    queryMock.queue('workspace_members', 'select', {
      data: [
        { workspace_id: 'w-1', role: 'owner', workspaces: { id: 'w-1', name: 'Workspace Principal' } },
      ],
      error: null,
    });

    module.updateSidebarUI({
      nome: 'Ana Maria',
      active_workspace_id: 'w-1',
    });

    expect(document.querySelector('.sidebar .avatar')).toHaveTextContent('AM');
    expect(document.querySelector('.sidebar .user-name')).toHaveTextContent('Ana Maria');
    expect(document.getElementById('mobile-avatar')).toHaveTextContent('AM');
    expect(document.getElementById('mobile-user-name')).toHaveTextContent('Ana Maria');

    await waitFor(() => {
      expect(document.getElementById('workspace-switcher')).toHaveStyle({ display: 'none' });
    });
  });

  it('renders workspace options and updates the active workspace on click', async () => {
    const { module, queryMock } = await loadSupabaseModule({ id: 'user-1' });
    mountSidebarFixture();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    queryMock.queue('workspace_members', 'select', {
      data: [
        { workspace_id: 'w-1', role: 'owner', workspaces: { id: 'w-1', name: 'Workspace Principal' } },
        { workspace_id: 'w-2', role: 'owner', workspaces: { id: 'w-2', name: 'Workspace Secundario' } },
      ],
      error: null,
    });
    queryMock.queue('profiles', 'update', {
      data: null,
      error: null,
    });

    module.updateSidebarUI({
      nome: 'Ana Maria',
      active_workspace_id: 'w-1',
    });

    await waitFor(() => {
      expect(document.querySelectorAll('#workspace-list button')).toHaveLength(2);
    });

    fireEvent.click(document.querySelectorAll('#workspace-list button')[1]!);

    await waitFor(() => {
      expect(
        queryMock.calls.some(
          (call) =>
            call.table === 'profiles'
            && call.operation === 'update'
            && (call.payload as Record<string, string>).active_workspace_id === 'w-2',
        ),
      ).toBe(true);
    });

    expect(errorSpy).not.toHaveBeenCalledWith('populateWorkspaceSwitcher error:', expect.anything());
  });

  it('forwards auth helper calls with the expected payloads', async () => {
    const { module, auth } = await loadSupabaseModule({ id: 'user-1' });

    await module.signIn('ana@mesaas.com', 'segredo');
    await module.signUp('ana@mesaas.com', 'segredo', { nome: 'Ana', empresa: 'Mesaas' });
    await module.resetPassword('ana@mesaas.com');
    await module.signOut();

    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'ana@mesaas.com',
      password: 'segredo',
    });
    expect(auth.signUp).toHaveBeenCalledWith({
      email: 'ana@mesaas.com',
      password: 'segredo',
      options: {
        data: { nome: 'Ana', empresa: 'Mesaas' },
        emailRedirectTo: `${window.location.origin}/login`,
      },
    });
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('ana@mesaas.com', {
      redirectTo: `${window.location.origin}/configurar-senha`,
    });
    expect(auth.signOut).toHaveBeenCalled();
  });
});
