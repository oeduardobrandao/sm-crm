import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () =>
    false;
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
});

const { useAuthMock, seedFinanceiroMock, toastMock, entitlementMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  seedFinanceiroMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
  entitlementMock: vi.fn(),
}));

vi.mock('@/context/AuthContext', () => ({ useAuth: useAuthMock }));
vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('@/lib/entitlement-toast', () => ({ handleEntitlementMutationError: entitlementMock }));
vi.mock('@/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store')>()),
  seedFinanceiro: seedFinanceiroMock,
}));

import OnboardingCard from '../OnboardingCard';

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  render(
    <QueryClientProvider client={queryClient}>
      <OnboardingCard />
    </QueryClientProvider>,
  );
  return { invalidate };
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthMock.mockReturnValue({ profile: { conta_id: 'w1' } });
  entitlementMock.mockReturnValue(false);
  seedFinanceiroMock.mockResolvedValue({ seeded: true, ja_existia: false });
});

describe('OnboardingCard', () => {
  it('explains what the seed does', () => {
    renderCard();

    expect(screen.getByText('Montar o financeiro a partir dos dados atuais')).toBeVisible();
    expect(
      screen.getByText(
        'Vamos usar a mensalidade de cada cliente e o custo de cada pessoa da equipe. Nada é apagado.',
      ),
    ).toBeVisible();
    expect(
      screen.getByRole('combobox', { name: 'O período financeiro começa no dia' }),
    ).toHaveTextContent('1');
  });

  it('onboarding_calls_seed_with_day', async () => {
    const user = userEvent.setup();
    const { invalidate } = renderCard();

    await user.click(screen.getByRole('combobox', { name: 'O período financeiro começa no dia' }));
    await user.click(await screen.findByRole('option', { name: '15' }));
    await user.click(screen.getByRole('button', { name: 'Montar a partir dos dados atuais' }));

    await waitFor(() => expect(seedFinanceiroMock).toHaveBeenCalledWith(15));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['financeiro-v2'] }));
    expect(toastMock.success).toHaveBeenCalled();
  });

  it('seeds with day 1 by default', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('button', { name: 'Montar a partir dos dados atuais' }));

    await waitFor(() => expect(seedFinanceiroMock).toHaveBeenCalledWith(1));
  });

  it('offers days 1 to 28 only', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('combobox', { name: 'O período financeiro começa no dia' }));

    expect(await screen.findAllByRole('option')).toHaveLength(28);
    expect(screen.getByRole('option', { name: '28' })).toBeVisible();
    expect(screen.queryByRole('option', { name: '29' })).toBeNull();
  });

  it('shows an error toast and re-enables the button when the seed fails', async () => {
    const user = userEvent.setup();
    seedFinanceiroMock.mockRejectedValue(new Error('boom'));
    renderCard();

    await user.click(screen.getByRole('button', { name: 'Montar a partir dos dados atuais' }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith('Erro ao montar o financeiro'),
    );
    expect(entitlementMock).toHaveBeenCalledWith(expect.any(Error), 'w1');
    expect(screen.getByRole('button', { name: 'Montar a partir dos dados atuais' })).toBeEnabled();
  });
});
