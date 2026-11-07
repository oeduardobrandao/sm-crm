import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigationType } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { useNativePathGuard } from '../useNativePathGuard';

type CapacitorStub = { isNativePlatform?: () => boolean };

function setCapacitor(stub: CapacitorStub | undefined) {
  (window as unknown as { Capacitor?: CapacitorStub }).Capacitor = stub;
}

afterEach(() => setCapacitor(undefined));

function Probe() {
  useNativePathGuard();
  const location = useLocation();
  const navigationType = useNavigationType();
  return (
    <>
      <div data-testid="path">{location.pathname + location.search}</div>
      <div data-testid="nav-type">{navigationType}</div>
    </>
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Probe />
    </MemoryRouter>,
  );
}

describe('useNativePathGuard', () => {
  it('sends a blocked path to /dashboard inside the app', async () => {
    setCapacitor({ isNativePlatform: () => true });
    renderAt('/precos');
    await waitFor(() => expect(screen.getByTestId('path').textContent).toBe('/dashboard'));
    // replace, so Back never returns to the blocked page.
    expect(screen.getByTestId('nav-type').textContent).toBe('REPLACE');
  });

  it('also catches the landing and billing settings', async () => {
    setCapacitor({ isNativePlatform: () => true });
    renderAt('/configuracao/cobranca');
    await waitFor(() => expect(screen.getByTestId('path').textContent).toBe('/dashboard'));
  });

  it('leaves app routes alone inside the app', () => {
    setCapacitor({ isNativePlatform: () => true });
    renderAt('/configuracao/notificacoes');
    expect(screen.getByTestId('path').textContent).toBe('/configuracao/notificacoes');
  });

  it('never redirects on the web', () => {
    renderAt('/precos');
    expect(screen.getByTestId('path').textContent).toBe('/precos');
  });
});
