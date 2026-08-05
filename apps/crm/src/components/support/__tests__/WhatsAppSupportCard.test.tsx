import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock('@/context/AuthContext', () => ({ useAuth: useAuthMock }));
vi.mock('@/lib/analytics', () => ({ captureEvent: vi.fn() }));

const KEY = 'whatsapp_support_dismissed_conta-1';

function authAs(role: string) {
  useAuthMock.mockReturnValue({
    role,
    workspaceRole: role,
    profile: { conta_id: 'conta-1', nome: 'Ana Souza', empresa: 'Acme' },
  });
}

/** The module under test reads env at module scope, so re-import per case. */
async function renderCard(number = '5511999999999') {
  vi.resetModules();
  vi.stubEnv('VITE_WHATSAPP_SUPPORT_NUMBER', number);
  const { WhatsAppSupportCard } = await import('../WhatsAppSupportCard');
  return render(<WhatsAppSupportCard />);
}

describe('WhatsAppSupportCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    localStorage.clear();
    authAs('owner');
  });

  it('renders for an owner when configured', async () => {
    await renderCard();
    expect(screen.getByText('Fale com a gente no WhatsApp')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir WhatsApp' })).toHaveAttribute(
      'target',
      '_blank',
    );
  });

  it('does not render for a non-owner', async () => {
    authAs('agent');
    await renderCard();
    expect(screen.queryByText('Fale com a gente no WhatsApp')).not.toBeInTheDocument();
  });

  it('does not render when the support number is unset', async () => {
    // Otherwise the card would ship with a title and no CTA at all.
    await renderCard('');
    expect(screen.queryByText('Fale com a gente no WhatsApp')).not.toBeInTheDocument();
  });

  it('does not render when already dismissed', async () => {
    localStorage.setItem(KEY, new Date().toISOString());
    await renderCard();
    expect(screen.queryByText('Fale com a gente no WhatsApp')).not.toBeInTheDocument();
  });

  it('treats an old timestamp as still dismissed', async () => {
    // Unlike TrialNudgeCard's 7-day window, dismissal here is permanent.
    localStorage.setItem(KEY, '2020-01-01T00:00:00.000Z');
    await renderCard();
    expect(screen.queryByText('Fale com a gente no WhatsApp')).not.toBeInTheDocument();
  });

  it.each(['true', 'sim', '', 'not-a-date'])(
    'shows the card when the stored value %o is not a valid date',
    async (raw) => {
      // A corrupt entry must fail toward showing the card, never toward hiding
      // it forever.
      localStorage.setItem(KEY, raw);
      await renderCard();
      expect(screen.getByText('Fale com a gente no WhatsApp')).toBeInTheDocument();
    },
  );

  it('persists a valid ISO timestamp on dismiss and hides the card', async () => {
    await renderCard();
    fireEvent.click(screen.getByLabelText('Fechar aviso'));
    expect(screen.queryByText('Fale com a gente no WhatsApp')).not.toBeInTheDocument();
    const stored = localStorage.getItem(KEY);
    expect(stored).not.toBeNull();
    expect(Number.isNaN(new Date(stored!).getTime())).toBe(false);
  });
});
