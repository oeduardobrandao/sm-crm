import { fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/supabase', () => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  resetPassword: vi.fn(),
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(() => ({ user: null, loading: false })),
}));
vi.mock('@/lib/metaPixelLoader', () => ({
  trackMetaEvent: vi.fn(),
  trackMetaCustomEvent: vi.fn(() => true),
}));

import { trackMetaCustomEvent } from '@/lib/metaPixelLoader';
import LoginPage from '../LoginPage';
import { resetSignupStartedForTests } from '../signupStarted';

const mockedCustom = vi.mocked(trackMetaCustomEvent);

const byId = (id: string) => document.getElementById(id) as HTMLElement;

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LoginPage />
    </MemoryRouter>,
  );
}

describe('IniciouCadastro (Meta)', () => {
  beforeEach(() => {
    resetSignupStartedForTests();
    mockedCustom.mockReset();
    mockedCustom.mockReturnValue(true);
  });

  it('fires once on the first focus inside the signup form, across fields and remounts', () => {
    const { unmount } = renderAt('/login?tab=register');
    fireEvent.focus(byId('reg-nome'));
    fireEvent.focus(byId('reg-email'));
    expect(mockedCustom).toHaveBeenCalledTimes(1);
    expect(mockedCustom).toHaveBeenCalledWith('IniciouCadastro', { origem: 'formulario' });

    unmount();
    renderAt('/login?tab=register');
    fireEvent.focus(byId('reg-nome'));
    expect(mockedCustom).toHaveBeenCalledTimes(1);
  });

  it('does not fire from the login form', () => {
    renderAt('/login');
    fireEvent.focus(byId('login-email'));
    expect(mockedCustom).not.toHaveBeenCalled();
  });

  it('retries on the next focus when the first attempt had no marketing consent', () => {
    mockedCustom.mockReturnValueOnce(false);
    renderAt('/login?tab=register');
    fireEvent.focus(byId('reg-nome'));
    fireEvent.focus(byId('reg-email'));
    fireEvent.focus(byId('reg-password'));
    expect(mockedCustom).toHaveBeenCalledTimes(2);
  });
});
