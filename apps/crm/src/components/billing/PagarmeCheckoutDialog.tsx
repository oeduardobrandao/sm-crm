import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { getIntlLocale, i18n } from '@mesaas/i18n';
import { format } from 'date-fns';
import { CalendarDays, CreditCard, Lock } from 'lucide-react';
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
import { ceilPeriodEndToUtcDate } from '@/pages/configuracao/cobranca/plan-display';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { PagarmeLogo } from './PagarmeLogo';
import './pagarmeCheckoutPhone.css';

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
  /** Checkout mode only: !hasUsedTrial(subscription, effectivePlan) (a demo has used it too). */
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

/**
 * Espelho do TRIAL_DAYS de supabase/functions/_shared/trial.ts, usado só para a data PREVISTA
 * no aviso verde (mesma conta do resolveStartAt do backend: now + 30d com ceil para a próxima
 * meia-noite UTC, via ceilPeriodEndToUtcDate). A data autoritativa é o trial_ends_at do
 * response, exibido na tela de sucesso.
 */
const TRIAL_DAYS = 30;

/** Campos do modelo: altos e arredondados. Concatenado (não cn) para preservar ph-no-capture. */
const FIELD_CLASS = 'h-10 rounded-xl px-4';

/** Espaço label-campo compacto (o space-y-2 default do FormItem estoura o fold do dialog). */
const ITEM_CLASS = 'space-y-0.5';

/** plans.price_brl_annual is stored in centavos (e.g. 999000 = R$ 9.990,00). */
function formatBRL(centavos: number): string {
  return new Intl.NumberFormat(getIntlLocale(), { style: 'currency', currency: 'BRL' }).format(
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
  // English shows the US order (MM/dd/yyyy); Portuguese keeps dd/MM/yyyy.
  if (getIntlLocale() === 'en-US') return `${mo}/${d}/${y}`;
  return `${d}/${mo}/${y}`;
}

/** Validation copy, resolved when the schema runs (not when it is built) so it follows the language. */
function vt(key: string): string {
  return i18n.t(`billing:pagarmeCheckout.validation.${key}`);
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
          message: vt('cardNumber'),
        });
      }
      if (v.holderName.trim().length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['holderName'],
          message: vt('holderName'),
        });
      }
      if (parseExpiry(v.expiry) === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['expiry'],
          message: vt('expiry'),
        });
      }
      if (!/^\d{3,4}$/.test(v.cvv)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['cvv'], message: vt('cvv') });
      }
      if (onlyDigits(v.cep).length !== 8) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['cep'], message: vt('cep') });
      }
      if (v.line1.trim().length < 3) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['line1'],
          message: vt('line1'),
        });
      }
      if (v.city.trim().length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['city'],
          message: vt('city'),
        });
      }
      if (!/^[A-Za-z]{2}$/.test(v.state)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['state'], message: vt('state') });
      }
      if (mode === 'checkout' || mode === 'switch') {
        if (!documentValid(v.document)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['document'],
            message: vt('document'),
          });
        }
        if (splitPhone(v.phone) === null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['phone'],
            message: vt('phone'),
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
  const { t } = useTranslation('billing');
  const [step, setStep] = useState<'form' | 'success'>('form');
  const [saving, setSaving] = useState(false);
  const [successResult, setSuccessResult] = useState<PagarmeCheckoutResult | null>(null);
  // Fires 'card_form_abandoned' at most once per open.
  const abandonedFiredRef = useRef(false);
  // Phones (below 768px) get the full-screen layout. Not usePhoneLayout(): /comecar renders
  // this outside AppLayout, where that context reports desktop.
  const isPhone = !useIsDesktop(768);

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
            toast.error(t('pagarmeCheckout.genericError'));
          }
        }
      } else {
        try {
          await updatePagarmeCard(token, billingAddress);
          toast.success(t('pagarmeCheckout.cardUpdated'));
          onSuccess();
          onClose();
        } catch (err) {
          if (err instanceof BillingApiError) {
            toast.error(err.message);
          } else {
            toast.error(t('pagarmeCheckout.genericError'));
          }
        }
      }
    } finally {
      setSaving(false);
    }
  };

  if ((mode === 'checkout' || mode === 'switch') && !plan) return null;

  const trialEndPreview =
    mode === 'checkout' && trialEligible
      ? ceilPeriodEndToUtcDate(new Date(Date.now() + TRIAL_DAYS * 24 * 3600 * 1000).toISOString())
      : null;

  const ctaLabel =
    mode === 'checkout'
      ? trialEligible
        ? t('pagarmeCheckout.cta.startTrial')
        : t('pagarmeCheckout.cta.confirmSubscription')
      : mode === 'switch'
        ? t('pagarmeCheckout.cta.confirmSwitch')
        : t('pagarmeCheckout.cta.saveCard');

  const successTitle =
    mode === 'switch'
      ? t('pagarmeCheckout.successTitle.switch')
      : t('pagarmeCheckout.successTitle.subscription');
  const successDescription =
    mode === 'switch'
      ? `${
          successResult?.first_charge_at
            ? t('pagarmeCheckout.success.switchFirstCharge', {
                date: formatUtcDateBR(successResult.first_charge_at),
              })
            : t('pagarmeCheckout.success.switchScheduled')
        }${
          switchChangesPlan
            ? t('pagarmeCheckout.success.switchPlanNow', { name: plan?.name })
            : t('pagarmeCheckout.success.switchNothingChanges')
        }`
      : successResult?.trial_ends_at
        ? t('pagarmeCheckout.success.trialEnds', {
            date: formatUtcDateBR(successResult.trial_ends_at),
          })
        : t('pagarmeCheckout.success.active');

  const formTitle =
    mode === 'checkout'
      ? t('pagarmeCheckout.formTitleCheckout', { name: plan?.name })
      : mode === 'switch'
        ? t('shared.switchToAnnual12x')
        : t('shared.updateCard');

  const formDescription =
    mode === 'checkout' || mode === 'switch'
      ? t('pagarmeCheckout.formDescriptionPlan')
      : t('pagarmeCheckout.formDescriptionUpdateCard');

  const planSummary = (
    <>
      {(mode === 'checkout' || mode === 'switch') && plan && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-2xl bg-muted px-4 py-2">
          <p className="whitespace-nowrap">
            <span className="text-xl font-bold tracking-tight">
              {t('pagarmeCheckout.installments', {
                price: formatBRL(plan.pagarme_installment_cents),
              })}
            </span>{' '}
            <span className="text-sm">{t('pagarmeCheckout.interestFree')}</span>
          </p>
          <p className="text-sm text-muted-foreground">
            {t('pagarmeCheckout.totalPerYear', {
              price: formatBRL(plan.pagarme_installment_cents * 12),
            })}
          </p>
        </div>
      )}
    </>
  );

  const payUpfront = (
    <>
      {mode === 'checkout' && plan && onPayUpfront && (
        <p className="text-xs text-muted-foreground">
          {t('pagarmeCheckout.upfrontPrice', { price: formatBRL(plan.price_brl_annual) })}
          <button
            type="button"
            className="underline underline-offset-2 disabled:no-underline disabled:opacity-50"
            onClick={onPayUpfront}
            disabled={saving}
          >
            {t('pagarmeCheckout.payUpfront')}
          </button>
        </p>
      )}
    </>
  );

  const cardFields = (
    <>
      <FormField
        control={form.control}
        name="cardNumber"
        render={({ field }) => (
          <FormItem className={ITEM_CLASS}>
            <FormLabel className="text-xs">{t('pagarmeCheckout.fields.cardNumber')}</FormLabel>
            {/* O wrapper do ícone fica FORA do FormControl: o Slot precisa do Input
              como filho direto para o id/aria cair no input (senão o label quebra). */}
            <div className="relative">
              <CreditCard
                aria-hidden="true"
                className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground"
              />
              <FormControl>
                <Input
                  {...field}
                  onChange={(e) => field.onChange(maskCardNumber(e.target.value))}
                  placeholder="0000 0000 0000 0000"
                  autoComplete="cc-number"
                  inputMode="numeric"
                  className={`${FIELD_CLASS} pl-11 ph-no-capture`}
                />
              </FormControl>
            </div>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="holderName"
        render={({ field }) => (
          <FormItem className={ITEM_CLASS}>
            <FormLabel className="text-xs">{t('pagarmeCheckout.fields.holderName')}</FormLabel>
            <FormControl>
              <Input
                {...field}
                placeholder={t('pagarmeCheckout.fields.holderNamePlaceholder')}
                autoComplete="cc-name"
                className={`${FIELD_CLASS} ph-no-capture`}
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
            <FormItem className={ITEM_CLASS}>
              <FormLabel className="text-xs">{t('pagarmeCheckout.fields.expiry')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  onChange={(e) => field.onChange(maskExpiry(e.target.value))}
                  placeholder={t('pagarmeCheckout.fields.expiryPlaceholder')}
                  autoComplete="cc-exp"
                  inputMode="numeric"
                  className={`${FIELD_CLASS} ph-no-capture`}
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
            <FormItem className={ITEM_CLASS}>
              <FormLabel className="text-xs">{t('pagarmeCheckout.fields.cvv')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  onChange={(e) => field.onChange(onlyDigits(e.target.value).slice(0, 4))}
                  placeholder="123"
                  type="password"
                  inputMode="numeric"
                  autoComplete="cc-csc"
                  className={`${FIELD_CLASS} ph-no-capture`}
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
              <FormItem className={ITEM_CLASS}>
                <FormLabel className="text-xs">{t('pagarmeCheckout.fields.document')}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    onChange={(e) => field.onChange(maskDocument(e.target.value))}
                    placeholder="000.000.000-00"
                    inputMode="numeric"
                    className={`${FIELD_CLASS} ph-no-capture`}
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
              <FormItem className={ITEM_CLASS}>
                <FormLabel className="text-xs">{t('pagarmeCheckout.fields.phone')}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    onChange={(e) => field.onChange(maskPhone(e.target.value))}
                    placeholder="(11) 99999-0000"
                    autoComplete="tel"
                    inputMode="numeric"
                    className={FIELD_CLASS}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      )}
      <div className="grid grid-cols-[2fr_3fr] gap-3">
        <FormField
          control={form.control}
          name="cep"
          render={({ field }) => (
            <FormItem className={ITEM_CLASS}>
              <FormLabel className="text-xs">{t('pagarmeCheckout.fields.cep')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  onChange={(e) => field.onChange(maskCep(e.target.value))}
                  placeholder="00000-000"
                  autoComplete="postal-code"
                  inputMode="numeric"
                  className={FIELD_CLASS}
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
            <FormItem className={ITEM_CLASS}>
              <FormLabel className="text-xs">{t('pagarmeCheckout.fields.line1')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder={t('pagarmeCheckout.fields.line1Placeholder')}
                  autoComplete="address-line1"
                  className={FIELD_CLASS}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
      <div className="grid grid-cols-[2fr_1fr] gap-3">
        <FormField
          control={form.control}
          name="city"
          render={({ field }) => (
            <FormItem className={ITEM_CLASS}>
              <FormLabel className="text-xs">{t('pagarmeCheckout.fields.city')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder={t('pagarmeCheckout.fields.cityPlaceholder')}
                  autoComplete="address-level2"
                  className={FIELD_CLASS}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="state"
          render={({ field }) => (
            <FormItem className={ITEM_CLASS}>
              <FormLabel className="text-xs">{t('pagarmeCheckout.fields.state')}</FormLabel>
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
                  placeholder={t('pagarmeCheckout.fields.statePlaceholder')}
                  autoComplete="address-level1"
                  className={FIELD_CLASS}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </>
  );

  const formNotes = (
    <>
      {mode === 'checkout' && trialEligible && (
        <div className="flex items-start gap-3 rounded-2xl bg-emerald-500/10 px-4 py-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
          <CalendarDays aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            {trialEndPreview
              ? t('pagarmeCheckout.notes.trialOn', { date: formatUtcDateBR(trialEndPreview) })
              : t('pagarmeCheckout.notes.trialNoDate')}
          </p>
        </div>
      )}

      {mode === 'switch' && (
        <div className="flex items-start gap-3 rounded-2xl bg-emerald-500/10 px-4 py-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
          <CalendarDays aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            {firstChargeAt
              ? t('pagarmeCheckout.notes.switchOn', { date: formatUtcDateBR(firstChargeAt) })
              : t('pagarmeCheckout.notes.switchNoDate')}
          </p>
        </div>
      )}
    </>
  );

  const securityNote = (
    <>
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <div className="flex items-start gap-2">
          <Lock aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
          <p>{t('pagarmeCheckout.notes.security')}</p>
        </div>
        <PagarmeLogo className="h-6 w-auto shrink-0" />
      </div>
    </>
  );

  const submitButton = (
    <Button
      type="submit"
      disabled={saving}
      className="mb-0 h-10 w-full rounded-2xl text-[15px] font-semibold"
    >
      {saving ? t('pagarmeCheckout.processing') : ctaLabel}
    </Button>
  );
  const guardDismiss = {
    onEscapeKeyDown: (e: KeyboardEvent) => {
      // Belt-and-suspenders with the `saving` check inside handleClose: block Radix's
      // internal dismiss at the source too, so a request in flight never even reaches
      // onOpenChange(false) via Escape.
      if (saving) e.preventDefault();
    },
    onInteractOutside: (e: Event) => {
      // Same guard for overlay clicks and any other outside interaction (covers pointerdown
      // and focus-outside dismissal alike — see the house DialogContent's own onConfirmClose
      // feature, which relies on this same event for its own close guard).
      if (saving) e.preventDefault();
    },
  };

  if (isPhone) {
    // Phones: full screen, a nav bar with Fechar, the fields in one column and the primary
    // action in a bar pinned to the bottom. Same form, fields, validation and submit.
    return (
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) handleClose();
        }}
      >
        <DialogContent
          layout="fullscreen"
          className="pagarme-checkout-dialog phone-kit phone-pagarme-checkout"
          {...guardDismiss}
        >
          {step === 'success' ? (
            <>
              <header className="phone-pagarme-checkout__nav">
                <span />
                <DialogTitle className="phone-pagarme-checkout__nav-title">
                  {successTitle}
                </DialogTitle>
                <span />
              </header>
              <div className="phone-pagarme-checkout__body">
                <DialogDescription className="phone-pagarme-checkout__lead">
                  {successDescription}
                </DialogDescription>
              </div>
              <div className="phone-pagarme-checkout__bar">
                <Button
                  onClick={handleClose}
                  className="phone-pagarme-checkout__submit h-[50px] w-full rounded-2xl text-[17px] font-semibold"
                >
                  {source === 'onboarding'
                    ? t('pagarmeCheckout.goToDashboard')
                    : t('pagarmeCheckout.close')}
                </Button>
              </div>
            </>
          ) : (
            <>
              <header className="phone-pagarme-checkout__nav">
                <button
                  type="button"
                  className="phone-pagarme-checkout__close"
                  onClick={handleClose}
                  disabled={saving}
                >
                  {t('pagarmeCheckout.close')}
                </button>
                <DialogTitle className="phone-pagarme-checkout__nav-title">{formTitle}</DialogTitle>
                <span />
              </header>
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit(onSubmit)}
                  className="phone-pagarme-checkout__form"
                >
                  <div className="phone-pagarme-checkout__body">
                    <DialogDescription className="phone-pagarme-checkout__lead">
                      {formDescription}
                    </DialogDescription>
                    {planSummary}
                    {payUpfront}
                    <div className="phone-pagarme-checkout__fields">{cardFields}</div>
                    {formNotes}
                    {securityNote}
                  </div>
                  <div className="phone-pagarme-checkout__bar">{submitButton}</div>
                </form>
              </Form>
            </>
          )}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) handleClose();
      }}
    >
      <DialogContent
        className="pagarme-checkout-dialog sm:max-w-[540px] sm:rounded-3xl"
        {...guardDismiss}
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
                {source === 'onboarding'
                  ? t('pagarmeCheckout.goToDashboard')
                  : t('pagarmeCheckout.close')}
              </Button>
            </DialogFooter>
          </>
        ) : (
          /* Container único: o wrapper do DialogContent aplica grid gap-4 entre filhos diretos;
             com tudo dentro de um filho só, o espaçamento vertical inteiro fica sob controle
             daqui (gap-2.5), e o -my-2 recupera um pouco do p-6 fixo — é o que faz o form
             caber num fold de notebook sem scroll interno. */
          <div className="-my-3 flex flex-col gap-2">
            <DialogHeader className="space-y-1">
              <DialogTitle className="text-xl font-bold tracking-tight">{formTitle}</DialogTitle>
              <DialogDescription>{formDescription}</DialogDescription>
            </DialogHeader>

            {planSummary}

            {payUpfront}

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-2">
                {cardFields}

                {formNotes}

                {submitButton}

                {securityNote}
              </form>
            </Form>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
