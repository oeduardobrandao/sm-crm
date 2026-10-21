import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { tokenizeCardMock, startPagarmeCheckoutMock, updatePagarmeCardMock, captureEventMock } =
  vi.hoisted(() => ({
    tokenizeCardMock: vi.fn(),
    startPagarmeCheckoutMock: vi.fn(),
    updatePagarmeCardMock: vi.fn(),
    captureEventMock: vi.fn(),
  }));

// Phone branch (no Router on purpose: /comecar and the desktop suite render it bare).
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => false }));

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

import { type PagarmeCheckoutResult } from '@/services/billing';
import { PagarmeCheckoutDialog, type PagarmeCheckoutDialogProps } from '../PagarmeCheckoutDialog';

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
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

describe('PagarmeCheckoutDialog (phone)', () => {
  it('renders full screen with a Fechar nav bar, the title and the pay button in the bottom bar', () => {
    render(<PagarmeCheckoutDialog {...baseProps()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveClass('phone-pagarme-checkout');
    expect(dialog.className).not.toContain('sm:max-w-[540px]');
    // fullscreen layout: no built-in X, our own Fechar instead.
    expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeInTheDocument();
    expect(screen.getByText('Assinar o plano Pro')).toHaveClass(
      'phone-pagarme-checkout__nav-title',
    );
    expect(screen.getByText('12x de R$ 129,90')).toBeInTheDocument();

    const submit = screen.getByRole('button', { name: 'Começar 30 dias grátis' });
    expect(submit).toHaveAttribute('type', 'submit');
    expect(submit.closest('.phone-pagarme-checkout__bar')).not.toBeNull();
    // The bar sits inside the same <form>, so submit keeps working without form=.
    expect(submit.closest('form')).not.toBeNull();
  });

  it('keeps every field with its exact input attributes, stacked in one column', () => {
    render(<PagarmeCheckoutDialog {...baseProps()} />);
    const card = screen.getByLabelText('Número do cartão');
    expect(card).toHaveAttribute('autocomplete', 'cc-number');
    expect(card).toHaveAttribute('inputmode', 'numeric');
    expect(card).toHaveClass('ph-no-capture');
    const cvv = screen.getByLabelText('CVV');
    expect(cvv).toHaveAttribute('type', 'password');
    expect(cvv).toHaveAttribute('autocomplete', 'cc-csc');
    expect(screen.getByLabelText('Validade')).toHaveAttribute('autocomplete', 'cc-exp');
    expect(screen.getByLabelText('Celular')).toHaveAttribute('autocomplete', 'tel');
    expect(screen.getByLabelText('CEP')).toHaveAttribute('autocomplete', 'postal-code');
    expect(screen.getByLabelText('UF')).toHaveAttribute('autocomplete', 'address-level1');
    expect(card.closest('.phone-pagarme-checkout__fields')).not.toBeNull();
  });

  it('submits through the same checkout path with the same digits-only payload', async () => {
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    render(<PagarmeCheckoutDialog {...baseProps({ onSuccess, onClose })} />);
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
      document: VALID.document,
      phone: { ddd: '11', number: '987654321' },
      billing_address: { cep: VALID.cep, line_1: VALID.line1, city: VALID.city, state: 'SP' },
      source: 'billing',
    });
    expect(captureEventMock).toHaveBeenCalledWith('checkout_completed', {
      plan_id: 'pro',
      provider: 'pagarme',
    });

    expect(await screen.findByText('Assinatura confirmada!')).toBeInTheDocument();
    // Success: one Fechar (the bottom CTA), which completes the flow.
    const done = screen.getByRole('button', { name: 'Fechar' });
    fireEvent.click(done);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the same validation messages and never tokenizes an invalid form', async () => {
    render(<PagarmeCheckoutDialog {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Começar 30 dias grátis' }));
    expect(await screen.findByText('Número de cartão inválido.')).toBeInTheDocument();
    expect(screen.getByText('CPF ou CNPJ inválido.')).toBeInTheDocument();
    expect(tokenizeCardMock).not.toHaveBeenCalled();
  });

  it('Fechar goes through handleClose: abandonment analytics on a dirty form, then onClose', () => {
    const onClose = vi.fn();
    render(<PagarmeCheckoutDialog {...baseProps({ onClose })} />);
    fireEvent.change(screen.getByLabelText('Número do cartão'), { target: { value: '4242' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(captureEventMock).toHaveBeenCalledWith('card_form_abandoned', { mode: 'checkout' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores Fechar and Escape while the request is in flight', async () => {
    const onClose = vi.fn();
    const pending = deferred<PagarmeCheckoutResult>();
    startPagarmeCheckoutMock.mockReturnValueOnce(pending.promise);
    render(<PagarmeCheckoutDialog {...baseProps({ onClose })} />);
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Começar 30 dias grátis' }));
    await screen.findByRole('button', { name: 'Processando...' });

    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Assinar o plano Pro')).toBeInTheDocument();

    pending.resolve(CHECKOUT_RESULT);
    expect(await screen.findByText('Assinatura confirmada!')).toBeInTheDocument();
  });

  it('update-card mode saves through updatePagarmeCard and closes', async () => {
    const onClose = vi.fn();
    render(
      <PagarmeCheckoutDialog
        {...baseProps({ mode: 'update-card', plan: null, onClose, trialEligible: false })}
      />,
    );
    expect(screen.queryByLabelText('CPF ou CNPJ')).not.toBeInTheDocument();
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Salvar novo cartão' }));
    await waitFor(() => expect(updatePagarmeCardMock).toHaveBeenCalledTimes(1));
    expect(updatePagarmeCardMock).toHaveBeenCalledWith('token_abc', {
      cep: VALID.cep,
      line_1: VALID.line1,
      city: VALID.city,
      state: 'SP',
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
