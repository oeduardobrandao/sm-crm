import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { tokenizeCardMock, startPagarmeCheckoutMock, updatePagarmeCardMock, captureEventMock } =
  vi.hoisted(() => ({
    tokenizeCardMock: vi.fn(),
    startPagarmeCheckoutMock: vi.fn(),
    updatePagarmeCardMock: vi.fn(),
    captureEventMock: vi.fn(),
  }));

vi.mock('@/services/pagarme-token', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/pagarme-token')>();
  return { ...actual, tokenizeCard: tokenizeCardMock };
});

vi.mock('@/services/billing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/billing')>();
  return {
    ...actual,
    startPagarmeCheckout: startPagarmeCheckoutMock,
    updatePagarmeCard: updatePagarmeCardMock,
  };
});

vi.mock('@/lib/analytics', () => ({ captureEvent: captureEventMock }));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from 'sonner';
import { TokenizationError } from '@/services/pagarme-token';
import { BillingApiError, type PagarmeCheckoutResult } from '@/services/billing';
import {
  formatUtcDateBR,
  PagarmeCheckoutDialog,
  type PagarmeCheckoutDialogProps,
} from '../PagarmeCheckoutDialog';

// price_brl_annual is the à vista price; pagarme_installment_cents is the 12x's OWN, higher
// price with the financing embedded — deliberately not price_brl_annual / 12 (that derivation
// is exactly the bug this dialog must not reproduce).
const PLAN = { id: 'pro', name: 'Pro', price_brl_annual: 118800, pagarme_installment_cents: 12990 };

const VALID = {
  cardNumber: '4242424242424242',
  holderName: 'Ana Souza',
  expiry: '12/30',
  cvv: '123',
  document: '52998224725',
  phone: '11987654321',
  cep: '01310930',
  line1: 'Av Paulista 1000',
  city: 'São Paulo',
  state: 'sp',
};

function baseProps(
  overrides: Partial<PagarmeCheckoutDialogProps> = {},
): PagarmeCheckoutDialogProps {
  return {
    open: true,
    onClose: vi.fn(),
    mode: 'checkout',
    plan: PLAN,
    source: 'billing',
    trialEligible: true,
    onSuccess: vi.fn(),
    ...overrides,
  };
}

/** Fills every field this render actually has (document/phone only exist in checkout mode). */
function fillForm() {
  fireEvent.change(screen.getByLabelText('Número do cartão'), {
    target: { value: VALID.cardNumber },
  });
  fireEvent.change(screen.getByLabelText('Nome impresso no cartão'), {
    target: { value: VALID.holderName },
  });
  fireEvent.change(screen.getByLabelText('Validade'), { target: { value: VALID.expiry } });
  fireEvent.change(screen.getByLabelText('CVV'), { target: { value: VALID.cvv } });
  const documentInput = screen.queryByLabelText('CPF ou CNPJ');
  if (documentInput) fireEvent.change(documentInput, { target: { value: VALID.document } });
  const phoneInput = screen.queryByLabelText('Celular');
  if (phoneInput) fireEvent.change(phoneInput, { target: { value: VALID.phone } });
  fireEvent.change(screen.getByLabelText('CEP'), { target: { value: VALID.cep } });
  fireEvent.change(screen.getByLabelText('Endereço de cobrança'), {
    target: { value: VALID.line1 },
  });
  fireEvent.change(screen.getByLabelText('Cidade'), { target: { value: VALID.city } });
  fireEvent.change(screen.getByLabelText('UF'), { target: { value: VALID.state } });
}

/** A promise plus its own resolve/reject, for controlling exactly when an in-flight mock settles. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const CHECKOUT_RESULT: PagarmeCheckoutResult = {
  status: 'trialing',
  trial_ends_at: '2026-09-12T00:00:00.000Z',
  next_charge_at: '2026-09-12T00:00:00.000Z',
  installment_amount_cents: 9900,
};

beforeEach(() => {
  vi.clearAllMocks();
  tokenizeCardMock.mockResolvedValue('token_abc');
  startPagarmeCheckoutMock.mockResolvedValue(CHECKOUT_RESULT);
  updatePagarmeCardMock.mockResolvedValue(undefined);
});

describe('PagarmeCheckoutDialog', () => {
  it("renders the 12x summary (the parcela's OWN price, not price_brl_annual / 12) and the trial note when trialEligible is true", () => {
    render(<PagarmeCheckoutDialog {...baseProps()} />);
    expect(screen.getByText('12x de R$ 129,90')).toBeInTheDocument();
    expect(screen.getByText('sem juros')).toBeInTheDocument();
    expect(screen.getByText('total R$ 1.558,80/ano')).toBeInTheDocument();
    // A data é a PREVISÃO local (now + 30d, ceil UTC) — a autoritativa só existe no response,
    // então o teste pina o formato e a copy em volta, não um dia específico.
    expect(
      screen.getByText(
        /^30 dias grátis\. A primeira parcela só é cobrada em \d{2}\/\d{2}\/\d{4} e você pode cancelar antes disso\.$/,
      ),
    ).toBeInTheDocument();
  });

  it('hides the trial note when trialEligible is false', () => {
    render(<PagarmeCheckoutDialog {...baseProps({ trialEligible: false })} />);
    expect(screen.getByText('12x de R$ 129,90')).toBeInTheDocument();
    expect(screen.queryByText(/30 dias grátis/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar assinatura' })).toBeInTheDocument();
  });

  it('shows the à vista escape hatch only when onPayUpfront is provided, and fires it', () => {
    const onPayUpfront = vi.fn();
    const { rerender } = render(<PagarmeCheckoutDialog {...baseProps()} />);
    expect(screen.queryByText(/À vista sai por/)).not.toBeInTheDocument();

    rerender(<PagarmeCheckoutDialog {...baseProps({ onPayUpfront })} />);
    expect(screen.getByText(/À vista sai por R\$ 1\.188,00\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pagar à vista' }));
    expect(onPayUpfront).toHaveBeenCalledTimes(1);
  });

  it('disables the à vista button while saving, like every other control', async () => {
    const onPayUpfront = vi.fn();
    const pending = deferred<PagarmeCheckoutResult>();
    startPagarmeCheckoutMock.mockReturnValueOnce(pending.promise);
    render(<PagarmeCheckoutDialog {...baseProps({ onPayUpfront })} />);
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Começar 30 dias grátis' }));

    expect(await screen.findByRole('button', { name: 'Pagar à vista' })).toBeDisabled();
    pending.resolve(CHECKOUT_RESULT);
    await screen.findByText('Assinatura confirmada!');
  });

  it('hides document and phone fields, plan summary and trial note in update-card mode', () => {
    render(<PagarmeCheckoutDialog {...baseProps({ mode: 'update-card', trialEligible: false })} />);
    expect(screen.getByText('Atualizar cartão')).toBeInTheDocument();
    expect(screen.getByText('A próxima cobrança usa o novo cartão.')).toBeInTheDocument();
    expect(screen.queryByLabelText('CPF ou CNPJ')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Celular')).not.toBeInTheDocument();
    expect(screen.queryByText(/12x de/)).not.toBeInTheDocument();
    expect(screen.queryByText(/30 dias grátis/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar novo cartão' })).toBeInTheDocument();
  });

  it('every card/document input carries ph-no-capture', () => {
    render(<PagarmeCheckoutDialog {...baseProps()} />);
    for (const label of [
      'Número do cartão',
      'Nome impresso no cartão',
      'Validade',
      'CVV',
      'CPF ou CNPJ',
    ]) {
      expect(screen.getByLabelText(label)).toHaveClass('ph-no-capture');
    }
    expect(screen.getByLabelText('CVV')).toHaveAttribute('type', 'password');
  });

  it('shows the Luhn validation message and never calls tokenizeCard for an invalid card number', async () => {
    render(<PagarmeCheckoutDialog {...baseProps()} />);
    fillForm();
    fireEvent.change(screen.getByLabelText('Número do cartão'), {
      target: { value: '4242424242424241' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Começar 30 dias grátis' }));

    expect(await screen.findByText('Número de cartão inválido.')).toBeInTheDocument();
    expect(tokenizeCardMock).not.toHaveBeenCalled();
  });

  it('happy checkout path tokenizes, posts a digits-only payload and shows the formatted success step', async () => {
    render(<PagarmeCheckoutDialog {...baseProps()} />);
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Começar 30 dias grátis' }));

    await waitFor(() => expect(startPagarmeCheckoutMock).toHaveBeenCalledTimes(1));
    expect(tokenizeCardMock).toHaveBeenCalledWith({
      number: VALID.cardNumber,
      holderName: VALID.holderName,
      expMonth: 12,
      expYear: 2030,
      cvv: VALID.cvv,
    });
    expect(startPagarmeCheckoutMock).toHaveBeenCalledWith({
      plan_id: 'pro',
      card_token: 'token_abc',
      document: '52998224725',
      phone: { ddd: '11', number: '987654321' },
      billing_address: {
        cep: '01310930',
        line_1: VALID.line1,
        city: VALID.city,
        state: 'SP',
      },
      source: 'billing',
    });
    expect(captureEventMock).toHaveBeenCalledWith('card_form_submitted', {
      mode: 'checkout',
      plan_id: 'pro',
    });
    expect(captureEventMock).toHaveBeenCalledWith('checkout_completed', {
      plan_id: 'pro',
      provider: 'pagarme',
    });

    expect(await screen.findByText('Assinatura confirmada!')).toBeInTheDocument();
    // '2026-09-12T00:00:00.000Z' must render as 12/09/2026 literally, not through the runner's
    // local timezone: the gateway echoes trial_ends_at as a midnight-UTC boundary, and running it
    // through `new Date(iso)` + local formatting would print 11/09/2026 in Brazil (UTC-3).
    expect(screen.getByText(/12\/09\/2026/)).toBeInTheDocument();
    // source 'billing' fecha na própria página; 'Ir para o painel' é exclusivo do onboarding,
    // cujo onSuccess de fato navega para o dashboard.
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeInTheDocument();
  });

  it('labels the success CTA "Ir para o painel" only for the onboarding source', async () => {
    render(<PagarmeCheckoutDialog {...baseProps({ source: 'onboarding' })} />);
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Começar 30 dias grátis' }));
    expect(await screen.findByRole('button', { name: 'Ir para o painel' })).toBeInTheDocument();
  });

  it('closing from the success step calls onSuccess and onClose', async () => {
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    render(<PagarmeCheckoutDialog {...baseProps({ onSuccess, onClose })} />);
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Começar 30 dias grátis' }));
    const cta = await screen.findByRole('button', { name: 'Fechar' });
    fireEvent.click(cta);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('surfaces a TokenizationError on the card field and fires card_tokenization_failed, without calling startPagarmeCheckout', async () => {
    tokenizeCardMock.mockRejectedValueOnce(
      new TokenizationError('Cartão recusado. Confira os dados ou tente outro cartão.'),
    );
    render(<PagarmeCheckoutDialog {...baseProps()} />);
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Começar 30 dias grátis' }));

    expect(
      await screen.findByText('Cartão recusado. Confira os dados ou tente outro cartão.'),
    ).toBeInTheDocument();
    expect(captureEventMock).toHaveBeenCalledWith('card_tokenization_failed', {
      mode: 'checkout',
    });
    expect(startPagarmeCheckoutMock).not.toHaveBeenCalled();
  });

  it('toasts the server message and fires checkout_failed on BillingApiError', async () => {
    startPagarmeCheckoutMock.mockRejectedValueOnce(
      new BillingApiError('Cartão recusado pela operadora.', 'card_declined'),
    );
    render(<PagarmeCheckoutDialog {...baseProps()} />);
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Começar 30 dias grátis' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Cartão recusado pela operadora.'),
    );
    expect(captureEventMock).toHaveBeenCalledWith('checkout_failed', {
      plan_id: 'pro',
      code: 'card_declined',
    });
    expect(screen.queryByText('Assinatura confirmada!')).not.toBeInTheDocument();
  });

  it('retries with a fresh tokenizeCard call after a failure', async () => {
    tokenizeCardMock.mockRejectedValueOnce(new TokenizationError('Cartão recusado.'));
    render(<PagarmeCheckoutDialog {...baseProps()} />);
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Começar 30 dias grátis' }));
    await screen.findByText('Cartão recusado.');
    expect(tokenizeCardMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Começar 30 dias grátis' }));
    await waitFor(() => expect(tokenizeCardMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(startPagarmeCheckoutMock).toHaveBeenCalledTimes(1));
  });

  it('ignores Escape, the X button, and an outside click while a checkout request is in flight, then shows success once it settles', async () => {
    const onClose = vi.fn();
    const pending = deferred<PagarmeCheckoutResult>();
    startPagarmeCheckoutMock.mockReturnValueOnce(pending.promise);
    render(<PagarmeCheckoutDialog {...baseProps({ onClose })} />);
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Começar 30 dias grátis' }));

    // The submit button flips to its saving label once tokenizeCard resolves and
    // startPagarmeCheckout is in flight (never resolving yet, via the deferred promise).
    await screen.findByRole('button', { name: 'Processando...' });

    // X button: routes through the same Dialog onOpenChange as Escape/outside-click (Radix's
    // DialogClose composes onClick with context.onOpenChange(false)).
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    // Escape.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    // Outside pointerdown (overlay click). Radix's DismissableLayer wires its outside-pointerdown
    // listener inside a setTimeout(0), so a tick must pass before dispatching.
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.pointerDown(document.body);

    // None of the three dismiss attempts closed the dialog: onClose was never called, and the
    // in-flight form is still fully mounted (not the success step, not unmounted).
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Assinar o plano Pro')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Processando...' })).toBeInTheDocument();

    // Now let the request settle: the success step appears, proving the dialog wasn't stuck,
    // just held open for the duration of the in-flight request.
    pending.resolve(CHECKOUT_RESULT);
    expect(await screen.findByText('Assinatura confirmada!')).toBeInTheDocument();
  });

  it('applies the same in-flight close guard in update-card mode (shared handler)', async () => {
    const onClose = vi.fn();
    const pending = deferred<void>();
    updatePagarmeCardMock.mockReturnValueOnce(pending.promise);
    render(
      <PagarmeCheckoutDialog
        {...baseProps({ mode: 'update-card', onClose, trialEligible: false })}
      />,
    );
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Salvar novo cartão' }));
    await screen.findByRole('button', { name: 'Processando...' });

    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.pointerDown(document.body);

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Atualizar cartão')).toBeInTheDocument();

    pending.resolve();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('update-card happy path calls updatePagarmeCard and closes without a success step', async () => {
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    render(
      <PagarmeCheckoutDialog
        {...baseProps({ mode: 'update-card', onSuccess, onClose, trialEligible: false })}
      />,
    );
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Salvar novo cartão' }));

    await waitFor(() => expect(updatePagarmeCardMock).toHaveBeenCalledTimes(1));
    expect(updatePagarmeCardMock).toHaveBeenCalledWith('token_abc', {
      cep: '01310930',
      line_1: VALID.line1,
      city: VALID.city,
      state: 'SP',
    });
    expect(toast.success).toHaveBeenCalledWith('Cartão atualizado!');
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('fires card_form_abandoned at most once when closing a dirty form without saving', () => {
    const onClose = vi.fn();
    render(<PagarmeCheckoutDialog {...baseProps({ onClose })} />);
    fireEvent.change(screen.getByLabelText('Número do cartão'), {
      target: { value: '4242' },
    });
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(captureEventMock).toHaveBeenCalledWith('card_form_abandoned', { mode: 'checkout' });
    expect(captureEventMock).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not fire card_form_abandoned when the form was never touched', () => {
    const onClose = vi.fn();
    render(<PagarmeCheckoutDialog {...baseProps({ onClose })} />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(captureEventMock).not.toHaveBeenCalledWith('card_form_abandoned', expect.anything());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('modo switch', () => {
  const switchProps = () => ({
    ...baseProps(),
    mode: 'switch' as const,
    firstChargeAt: '2026-09-16',
    trialEligible: false,
  });

  const SWITCH_RESULT: PagarmeCheckoutResult = {
    status: 'trialing',
    trial_ends_at: null,
    next_charge_at: '2026-09-16',
    installment_amount_cents: 12990,
    switched: true,
    first_charge_at: '2026-09-16',
  };

  it('título e nota de previsão, sem copy de trial e sem saída à vista', () => {
    render(<PagarmeCheckoutDialog {...switchProps()} onPayUpfront={undefined} />);
    expect(screen.getByText('Trocar para o anual em 12x')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Sem cobrança agora. A primeira parcela está prevista para 16/09/2026, quando termina o período que você já pagou.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/30 dias grátis/)).not.toBeInTheDocument();
    expect(screen.queryByText('Pagar à vista')).not.toBeInTheDocument();
  });

  it('submit envia switch: true no payload', async () => {
    render(<PagarmeCheckoutDialog {...switchProps()} />);
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar troca' }));

    await waitFor(() => expect(startPagarmeCheckoutMock).toHaveBeenCalledTimes(1));
    expect(startPagarmeCheckoutMock).toHaveBeenCalledWith(
      expect.objectContaining({ switch: true }),
    );
  });

  it('CTA é "Confirmar troca"', () => {
    render(<PagarmeCheckoutDialog {...switchProps()} />);
    expect(screen.getByRole('button', { name: 'Confirmar troca' })).toBeInTheDocument();
  });

  it('sucesso usa first_charge_at do response e a copy de mesmo plano', async () => {
    startPagarmeCheckoutMock.mockResolvedValueOnce(SWITCH_RESULT);
    render(<PagarmeCheckoutDialog {...switchProps()} />);
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar troca' }));

    expect(await screen.findByText('Troca confirmada!')).toBeInTheDocument();
    expect(
      screen.getByText('Primeira parcela de 12x em 16/09/2026. Até lá nada muda no seu acesso.'),
    ).toBeInTheDocument();
  });

  it('sucesso com troca entre planos avisa a mudança imediata de recursos', async () => {
    startPagarmeCheckoutMock.mockResolvedValueOnce(SWITCH_RESULT);
    render(<PagarmeCheckoutDialog {...switchProps()} switchChangesPlan />);
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar troca' }));

    expect(await screen.findByText('Troca confirmada!')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Primeira parcela de 12x em 16/09/2026. Os recursos do plano Pro passam a valer imediatamente.',
      ),
    ).toBeInTheDocument();
  });

  it('firstChargeAt null degrada a nota sem data', () => {
    render(<PagarmeCheckoutDialog {...switchProps()} firstChargeAt={null} />);
    expect(
      screen.getByText(
        'Sem cobrança agora. A primeira parcela vem quando terminar o período que você já pagou.',
      ),
    ).toBeInTheDocument();
  });
});

describe('formatUtcDateBR', () => {
  it('reads the calendar date straight from the ISO prefix, never through a local timezone', () => {
    // The regression this guards: `format(new Date(iso), 'dd/MM/yyyy')` converts a midnight-UTC
    // timestamp through the runner's local offset, so in UTC-3 this would render 11/09/2026.
    // Pure string slicing sidesteps Date/timezone conversion entirely, so the assertion holds
    // regardless of which timezone the test runner (or a Brazil-based user's browser) is in.
    expect(formatUtcDateBR('2026-09-12T00:00:00.000Z')).toBe('12/09/2026');
  });

  it('formats a plain YYYY-MM-DD the same way, with no time component at all', () => {
    expect(formatUtcDateBR('2026-01-05')).toBe('05/01/2026');
  });

  it('degrades to the raw string instead of throwing for a non-date-prefixed input', () => {
    // Defensive only: the backend always sends a YYYY-MM-DD-prefixed ISO string, so this path
    // should never actually run against real data. date-fns' format() throws on an invalid
    // Date, and this renders inside a dialog with no error boundary, so the fallback must not
    // crash the component over a display string.
    expect(formatUtcDateBR('not-a-date')).toBe('not-a-date');
  });
});
