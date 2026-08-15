import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { captureEvent } from '@/lib/analytics';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  documentValid,
  luhnValid,
  maskCardNumber,
  maskCep,
  maskDocument,
  maskExpiry,
  maskPhone,
  onlyDigits,
  parseExpiry,
  splitPhone,
} from './card-validation';
import { tokenizeCard, TokenizationError } from '@/services/pagarme-token';
import {
  BillingApiError,
  startPagarmeCheckout,
  updatePagarmeCard,
  type CheckoutSource,
  type PagarmeCheckoutResult,
} from '@/services/billing';

export interface PagarmeCheckoutDialogProps {
  open: boolean;
  onClose: () => void;
  mode: 'checkout' | 'update-card' | 'switch';
  /** Required in checkout/switch mode; ignored (no summary/trial note) in update-card mode. */
  plan: {
    id: string;
    name: string;
    price_brl_annual: number;
    /** The 12x's own per-installment price, in centavos (NOT price_brl_annual / 12). */
    pagarme_installment_cents: number;
  } | null;
  source: CheckoutSource;
  /** Checkout mode only: !subscription.hasEverSubscribed. */
  trialEligible: boolean;
  /**
   * Checkout mode only. When provided, an "À vista sai por ..." escape hatch renders below the
   * 12x summary; clicking it calls this instead of submitting the card form. The parent is
   * expected to close this dialog and start the Stripe annual (à vista) checkout.
   */
  onPayUpfront?: () => void;
  /** Parent refetches subscription/plan. */
  onSuccess: () => void;
  /** Switch mode only. Data PREVISTA da 1ª parcela do switch (YYYY-MM-DD, ceil do mirror local).
   * A data autoritativa vem no response (first_charge_at) e é a única exibida como definitiva. */
  firstChargeAt?: string | null;
  /** Switch mode only. True quando o switch muda de plano (recursos passam a valer imediatamente). */
  switchChangesPlan?: boolean;
}

const GENERIC_ERROR_MESSAGE = 'Não foi possível concluir a operação. Tente novamente.';

/** plans.price_brl_annual is stored in centavos (e.g. 999000 = R$ 9.990,00). */
function formatBRL(centavos: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    centavos / 100,
  );
}

/**
 * Formats a backend calendar-date boundary (e.g. `trial_ends_at`) as `dd/MM/yyyy` WITHOUT
 * routing through the browser's local timezone. The gateway echoes `resolveStartAt`'s
 * `YYYY-MM-DD` back as a midnight-UTC timestamp (see pagarme-checkout/logic.ts), so
 * `format(new Date(iso), 'dd/MM/yyyy')` would convert that midnight through the visitor's
 * offset: in Brazil (UTC-3) `2026-09-12T00:00:00.000Z` prints as `11/09/2026`, a day early.
 * Reading the `YYYY-MM-DD` prefix directly sidesteps any timezone conversion entirely.
 */
export function formatUtcDateBR(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) {
    // Defensive only: the backend always sends a YYYY-MM-DD-prefixed ISO string, so this branch
    // should never run against real data. date-fns' format() throws on an invalid Date, and this
    // renders inside a success screen with no error boundary of its own, so a crash here would
    // take the whole dialog down over a display string — fall back to the raw value instead.
    try {
      return format(new Date(iso), 'dd/MM/yyyy');
    } catch {
      return iso;
    }
  }
  const [, y, mo, d] = m;
  return `${d}/${mo}/${y}`;
}

interface FormValues {
  cardNumber: string;
  holderName: string;
  expiry: string;
  cvv: string;
  document: string;
  phone: string;
  cep: string;
  line1: string;
  city: string;
  state: string;
}

const BLANK: FormValues = {
  cardNumber: '',
  holderName: '',
  expiry: '',
  cvv: '',
  document: '',
  phone: '',
  cep: '',
  line1: '',
  city: '',
  state: '',
};

/**
 * Single schema shared by all modes: document/phone are only validated (and only rendered) in
 * checkout and switch mode. superRefine (not separate z.object schemas per mode) keeps the
 * inferred FormValues shape identical across modes, which is what update-card's
 * unrendered-but-still-in-state document/phone fields need to type-check against.
 */
function buildSchema(mode: 'checkout' | 'update-card' | 'switch') {
  return z
    .object({
      cardNumber: z.string(),
      holderName: z.string(),
      expiry: z.string(),
      cvv: z.string(),
      document: z.string(),
      phone: z.string(),
      cep: z.string(),
      line1: z.string(),
      city: z.string(),
      state: z.string(),
    })
    .superRefine((v, ctx) => {
      if (!luhnValid(v.cardNumber)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['cardNumber'],
          message: 'Número de cartão inválido.',
        });
      }
      if (v.holderName.trim().length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['holderName'],
          message: 'Informe o nome do titular.',
        });
      }
      if (parseExpiry(v.expiry) === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['expiry'],
          message: 'Validade inválida.',
        });
      }
      if (!/^\d{3,4}$/.test(v.cvv)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['cvv'], message: 'CVV inválido.' });
      }
      if (onlyDigits(v.cep).length !== 8) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['cep'], message: 'CEP inválido.' });
      }
      if (v.line1.trim().length < 3) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['line1'],
          message: 'Informe o endereço.',
        });
      }
      if (v.city.trim().length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['city'],
          message: 'Informe a cidade.',
        });
      }
      if (!/^[A-Za-z]{2}$/.test(v.state)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['state'], message: 'UF inválida.' });
      }
      if (mode === 'checkout' || mode === 'switch') {
        if (!documentValid(v.document)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['document'],
            message: 'CPF ou CNPJ inválido.',
          });
        }
        if (splitPhone(v.phone) === null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['phone'],
            message: 'Celular inválido.',
          });
        }
      }
    });
}

export function PagarmeCheckoutDialog({
  open,
  onClose,
  mode,
  plan,
  source,
  trialEligible,
  onPayUpfront,
  onSuccess,
  firstChargeAt,
  switchChangesPlan,
}: PagarmeCheckoutDialogProps) {
  const [step, setStep] = useState<'form' | 'success'>('form');
  const [saving, setSaving] = useState(false);
  const [successResult, setSuccessResult] = useState<PagarmeCheckoutResult | null>(null);
  // Fires 'card_form_abandoned' at most once per open.
  const abandonedFiredRef = useRef(false);

  const schema = useMemo(() => buildSchema(mode), [mode]);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: BLANK,
  });
  // Read (not just call) formState.isDirty during render: react-hook-form's formState is a
  // lazily-tracked proxy that only keeps a field updated once something reads it inside render.
  // Reading it solely inside handleClose (an event-handler-only access) would leave isDirty
  // permanently stale at its initial `false`.
  const { isDirty } = form.formState;

  useEffect(() => {
    if (!open) return;
    form.reset(BLANK);
    setStep('form');
    setSuccessResult(null);
    setSaving(false);
    abandonedFiredRef.current = false;
  }, [open, form]);

  function handleClose() {
    if (step === 'success') {
      // Closing from success (CTA or X/overlay) is a completed flow, not an abandonment. No
      // request is in flight here — the checkout/update call has already settled by the time
      // this step renders — so this branch is never gated on `saving`.
      onSuccess();
      onClose();
      return;
    }
    // A tokenize/checkout/update-card request is in flight: the checkout POST is not cancelled
    // on close (an aborted request could still commit server-side), so closing here would let
    // the user believe they cancelled while a charge/subscription is created behind their back.
    // Ignore the close entirely and hold the dialog open until the request settles (the success
    // step renders, or the catch block below shows an error and re-enables the form).
    if (saving) return;
    if (isDirty && !abandonedFiredRef.current) {
      captureEvent('card_form_abandoned', { mode });
      abandonedFiredRef.current = true;
    }
    onClose();
  }

  const onSubmit = async (values: FormValues) => {
    setSaving(true);
    captureEvent('card_form_submitted', { mode, plan_id: plan?.id ?? null });
    try {
      const expiry = parseExpiry(values.expiry);
      if (!expiry) return; // guarded by schema; defensive only

      let token: string;
      try {
        token = await tokenizeCard({
          number: onlyDigits(values.cardNumber),
          holderName: values.holderName,
          expMonth: expiry.month,
          expYear: expiry.year,
          cvv: values.cvv,
        });
      } catch (err) {
        if (err instanceof TokenizationError) {
          captureEvent('card_tokenization_failed', { mode });
          form.setError('cardNumber', { message: err.message });
          return;
        }
        throw err;
      }

      const billingAddress = {
        cep: onlyDigits(values.cep),
        line_1: values.line1.trim(),
        city: values.city.trim(),
        state: values.state.toUpperCase(),
      };

      if (mode === 'checkout' || mode === 'switch') {
        if (!plan) return; // defensive: caller contract requires a plan in checkout/switch mode
        try {
          const result = await startPagarmeCheckout({
            plan_id: plan.id,
            card_token: token,
            document: onlyDigits(values.document),
            phone: splitPhone(values.phone)!,
            billing_address: billingAddress,
            source,
            ...(mode === 'switch' ? { switch: true as const } : {}),
          });
          captureEvent('checkout_completed', { plan_id: plan.id, provider: 'pagarme' });
          setSuccessResult(result);
          setStep('success');
        } catch (err) {
          if (err instanceof BillingApiError) {
            captureEvent('checkout_failed', { plan_id: plan.id, code: err.code ?? null });
            toast.error(err.message);
          } else {
            toast.error(GENERIC_ERROR_MESSAGE);
          }
        }
      } else {
        try {
          await updatePagarmeCard(token, billingAddress);
          toast.success('Cartão atualizado!');
          onSuccess();
          onClose();
        } catch (err) {
          if (err instanceof BillingApiError) {
            toast.error(err.message);
          } else {
            toast.error(GENERIC_ERROR_MESSAGE);
          }
        }
      }
    } finally {
      setSaving(false);
    }
  };

  if ((mode === 'checkout' || mode === 'switch') && !plan) return null;

  const ctaLabel =
    mode === 'checkout'
      ? trialEligible
        ? 'Começar 30 dias grátis'
        : 'Confirmar assinatura'
      : mode === 'switch'
        ? 'Confirmar troca'
        : 'Salvar novo cartão';

  const successTitle = mode === 'switch' ? 'Troca confirmada!' : 'Assinatura confirmada!';
  const successDescription =
    mode === 'switch'
      ? `${
          successResult?.first_charge_at
            ? `Primeira parcela de 12x em ${formatUtcDateBR(successResult.first_charge_at)}. `
            : 'Sua troca para o anual em 12x está agendada. '
        }${
          switchChangesPlan
            ? `Os recursos do plano ${plan?.name} passam a valer imediatamente.`
            : 'Até lá nada muda no seu acesso.'
        }`
      : successResult?.trial_ends_at
        ? `Seu teste grátis termina em ${formatUtcDateBR(successResult.trial_ends_at)}. Depois disso a cobrança de 12x começa automaticamente.`
        : 'Sua assinatura está ativa.';

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) handleClose();
      }}
    >
      <DialogContent
        className="sm:max-w-[480px]"
        onEscapeKeyDown={(e) => {
          // Belt-and-suspenders with the `saving` check inside handleClose: block Radix's
          // internal dismiss at the source too, so a request in flight never even reaches
          // onOpenChange(false) via Escape.
          if (saving) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          // Same guard for overlay clicks and any other outside interaction (covers pointerdown
          // and focus-outside dismissal alike — see the house DialogContent's own onConfirmClose
          // feature, which relies on this same event for its own close guard).
          if (saving) e.preventDefault();
        }}
      >
        {step === 'success' ? (
          <>
            <DialogHeader>
              <DialogTitle>{successTitle}</DialogTitle>
              <DialogDescription>{successDescription}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={handleClose}>
                {/* O destino real do CTA vem do onSuccess do pai: só o fluxo de onboarding
                    navega para o painel; no billing o dialog apenas fecha na própria página. */}
                {source === 'onboarding' ? 'Ir para o painel' : 'Fechar'}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                {mode === 'checkout'
                  ? `Assinar o plano ${plan?.name}`
                  : mode === 'switch'
                    ? 'Trocar para o anual em 12x'
                    : 'Atualizar cartão'}
              </DialogTitle>
              <DialogDescription>
                {mode === 'checkout' || mode === 'switch'
                  ? 'Anual no cartão de crédito'
                  : 'A próxima cobrança usa o novo cartão.'}
              </DialogDescription>
            </DialogHeader>

            {(mode === 'checkout' || mode === 'switch') && plan && (
              <div className="text-sm">
                <p>{`12x de ${formatBRL(plan.pagarme_installment_cents)} sem juros`}</p>
                <p className="text-muted-foreground">{`total ${formatBRL(plan.pagarme_installment_cents * 12)}/ano`}</p>
              </div>
            )}

            {mode === 'checkout' && plan && onPayUpfront && (
              <p className="text-xs text-muted-foreground">
                {`À vista sai por ${formatBRL(plan.price_brl_annual)}. `}
                <button
                  type="button"
                  className="underline underline-offset-2 disabled:no-underline disabled:opacity-50"
                  onClick={onPayUpfront}
                  disabled={saving}
                >
                  Pagar à vista
                </button>
              </p>
            )}

            {mode === 'checkout' && trialEligible && (
              <p className="text-sm text-muted-foreground">
                30 dias grátis. A primeira parcela só é cobrada depois do teste e você pode cancelar
                antes.
              </p>
            )}

            {mode === 'switch' && (
              <p className="text-sm text-muted-foreground">
                {firstChargeAt
                  ? `Sem cobrança agora. A primeira parcela está prevista para ${formatUtcDateBR(firstChargeAt)}, quando termina o período que você já pagou.`
                  : 'Sem cobrança agora. A primeira parcela vem quando terminar o período que você já pagou.'}
              </p>
            )}

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
                <FormField
                  control={form.control}
                  name="cardNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Número do cartão</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          onChange={(e) => field.onChange(maskCardNumber(e.target.value))}
                          placeholder="0000 0000 0000 0000"
                          autoComplete="cc-number"
                          inputMode="numeric"
                          className="ph-no-capture"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="holderName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nome no cartão</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="Nome como está no cartão"
                          autoComplete="cc-name"
                          className="ph-no-capture"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="expiry"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Validade</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            onChange={(e) => field.onChange(maskExpiry(e.target.value))}
                            placeholder="MM/AA"
                            autoComplete="cc-exp"
                            inputMode="numeric"
                            className="ph-no-capture"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="cvv"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>CVV</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            onChange={(e) => field.onChange(onlyDigits(e.target.value).slice(0, 4))}
                            placeholder="CVV"
                            type="password"
                            inputMode="numeric"
                            autoComplete="cc-csc"
                            className="ph-no-capture"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                {(mode === 'checkout' || mode === 'switch') && (
                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      control={form.control}
                      name="document"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>CPF ou CNPJ</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              onChange={(e) => field.onChange(maskDocument(e.target.value))}
                              placeholder="000.000.000-00"
                              inputMode="numeric"
                              className="ph-no-capture"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Celular</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              onChange={(e) => field.onChange(maskPhone(e.target.value))}
                              placeholder="(00) 00000-0000"
                              autoComplete="tel"
                              inputMode="numeric"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="cep"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>CEP</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            onChange={(e) => field.onChange(maskCep(e.target.value))}
                            placeholder="00000-000"
                            autoComplete="postal-code"
                            inputMode="numeric"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="line1"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Endereço</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="Rua, número"
                            autoComplete="address-line1"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="city"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Cidade</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Cidade" autoComplete="address-level2" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="state"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>UF</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            onChange={(e) =>
                              field.onChange(
                                e.target.value
                                  .toUpperCase()
                                  .replace(/[^A-Z]/g, '')
                                  .slice(0, 2),
                              )
                            }
                            placeholder="UF"
                            autoComplete="address-level1"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <p className="text-xs text-muted-foreground">
                  Seus dados vão direto para a Pagar.me com segurança. Nós não armazenamos o número
                  do seu cartão.
                </p>

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={handleClose} disabled={saving}>
                    Cancelar
                  </Button>
                  <Button type="submit" disabled={saving}>
                    {saving ? 'Processando...' : ctaLabel}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
