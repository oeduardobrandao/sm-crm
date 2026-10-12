import type { ChangeEvent, Dispatch, FormEvent, ReactNode, SetStateAction } from 'react';
import { Trash2 } from 'lucide-react';
import { Cell, FormRow, GroupedList } from '@mesaas/ios-kit';
import {
  FEATURE_FLAG_KEYS,
  FEATURE_FLAG_LABELS,
  RATE_LIMIT_KEYS,
  RATE_LIMIT_LABELS,
  RESOURCE_LIMIT_KEYS,
  RESOURCE_LIMIT_LABELS,
} from '../../lib/api';
import { useIsPhone } from '../../hooks/useIsPhone';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Switch } from '../../components/ui/switch';
import { parseIntInput, type FormState } from '../plan-form';

export const PLAN_FORM_ID = 'plan-form';

interface PlanFormFieldsProps {
  form: FormState;
  setForm: Dispatch<SetStateAction<FormState>>;
  onSubmit: (e: FormEvent) => void;
  /** Only passed for an existing plan with no workspaces. */
  onDelete?: () => void;
  deleting?: boolean;
}

/**
 * The plan form body, shared by the phone and desktop sheets. The page keeps the form state;
 * the sheet header's "Salvar" submits this form through `form={PLAN_FORM_ID}`.
 */
export function PlanFormFields({
  form,
  setForm,
  onSubmit,
  onDelete,
  deleting = false,
}: PlanFormFieldsProps) {
  const isPhone = useIsPhone();
  const text = (key: keyof FormState) => ({
    value: form[key] as string,
    onChange: (e: ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value })),
  });
  const toggle = (key: 'is_default' | 'is_active' | 'pagarme_12x_enabled') => ({
    checked: form[key],
    onCheckedChange: (checked: boolean) => setForm((f) => ({ ...f, [key]: checked })),
  });
  const enabledCount = FEATURE_FLAG_KEYS.filter((k) => form.features[k]).length;
  const setResource = (key: string, raw: string) =>
    setForm((f) => ({ ...f, resources: { ...f.resources, [key]: parseLimit(raw) } }));
  const setRate = (key: string, raw: string) =>
    setForm((f) => ({ ...f, rates: { ...f.rates, [key]: parseLimit(raw) } }));
  const setFeature = (key: string, checked: boolean) =>
    setForm((f) => ({ ...f, features: { ...f.features, [key]: checked } }));

  if (!isPhone) {
    return (
      <form id={PLAN_FORM_ID} onSubmit={onSubmit} className="flex flex-col gap-5">
        <Panel>
          <Grid cols="2fr_1fr">
            <Field label="Nome">
              <Input {...text('name')} required className={FIELD} />
            </Field>
            <Field label="Ordem">
              <Input
                type="number"
                step={1}
                min={0}
                placeholder="0"
                value={form.sort_order ?? ''}
                onChange={(e) =>
                  setForm((f) => ({ ...f, sort_order: parseIntInput(e.target.value) }))
                }
                className={FIELD}
              />
            </Field>
          </Grid>
        </Panel>

        <GroupedList aria-label="Opções">
          <Cell label="Padrão para novos workspaces" switch={toggle('is_default')} />
          <Cell label="Ativo" switch={toggle('is_active')} />
          <Cell label="Parcelamento 12x (Pagar.me)" switch={toggle('pagarme_12x_enabled')} />
        </GroupedList>

        <Section title="Preços">
          <Grid cols="repeat(3,1fr)">
            <Field label="Preço mensal (R$)">
              <Input
                {...text('price_brl_input')}
                inputMode="decimal"
                placeholder="99.90"
                className={FIELD}
              />
            </Field>
            <Field label="Preço anual (R$)">
              <Input
                {...text('price_brl_annual_input')}
                inputMode="decimal"
                placeholder="959.00"
                className={FIELD}
              />
            </Field>
            <Field label="Parcela 12x (R$)">
              <Input
                {...text('pagarme_installment_cents_input')}
                inputMode="decimal"
                placeholder="94.90"
                className={FIELD}
              />
            </Field>
          </Grid>
        </Section>

        <Section title="Cobrança">
          <Grid cols="repeat(2,1fr)">
            <Field label="ID do produto Stripe">
              <Input
                {...text('stripe_product_id')}
                placeholder="prod_..."
                className={`${FIELD} ${MONO}`}
              />
            </Field>
            <Field label="ID do preço Stripe (mensal)">
              <Input
                {...text('stripe_price_id')}
                placeholder="price_..."
                className={`${FIELD} ${MONO}`}
              />
            </Field>
            <Field label="ID do preço Stripe (anual)">
              <Input
                {...text('stripe_price_id_annual')}
                placeholder="price_..."
                className={`${FIELD} ${MONO}`}
              />
            </Field>
            <Field label="ID do plano Pagar.me (anual)">
              <Input
                {...text('pagarme_plan_id_annual')}
                placeholder="plan_..."
                className={`${FIELD} ${MONO}`}
              />
            </Field>
          </Grid>
        </Section>

        <Section title="Limites de recursos" note="Deixe vazio para ilimitado (∞).">
          <Grid cols="repeat(3,1fr)">
            {RESOURCE_LIMIT_KEYS.map((key) => (
              <Field key={key} label={RESOURCE_LIMIT_LABELS[key]}>
                <Input
                  type="number"
                  placeholder="∞"
                  value={form.resources[key] ?? ''}
                  onChange={(e) => setResource(key, e.target.value)}
                  className={FIELD}
                />
              </Field>
            ))}
          </Grid>
        </Section>

        <Section title={`Funcionalidades · ${enabledCount} de ${FEATURE_FLAG_KEYS.length}`}>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1">
            {FEATURE_FLAG_KEYS.map((key) => (
              <label key={key} className="flex min-h-9 items-center justify-between gap-3 text-sm">
                {FEATURE_FLAG_LABELS[key]}
                <Switch
                  checked={Boolean(form.features[key])}
                  onCheckedChange={(checked) => setFeature(key, checked)}
                />
              </label>
            ))}
          </div>
        </Section>

        <Section title="Limites de taxa" note="Deixe vazio para ilimitado (∞).">
          <Grid cols="repeat(3,1fr)">
            {RATE_LIMIT_KEYS.map((key) => (
              <Field key={key} label={RATE_LIMIT_LABELS[key]}>
                <Input
                  type="number"
                  placeholder="∞"
                  value={form.rates[key] ?? ''}
                  onChange={(e) => setRate(key, e.target.value)}
                  className={FIELD}
                />
              </Field>
            ))}
          </Grid>
        </Section>

        {onDelete && (
          <div>
            <Button type="button" variant="destructive" disabled={deleting} onClick={onDelete}>
              <Trash2 aria-hidden="true" /> Excluir plano
            </Button>
          </div>
        )}
      </form>
    );
  }

  return (
    <form id={PLAN_FORM_ID} onSubmit={onSubmit} className="flex flex-col gap-5">
      <GroupedList aria-label="Geral">
        <FormRow label="Nome" input={{ ...text('name'), required: true }} />
        <Cell label="Padrão para novos workspaces" switch={toggle('is_default')} />
        <Cell label="Ativo" switch={toggle('is_active')} />
        <Cell label="Parcelamento 12x (Pagar.me)" switch={toggle('pagarme_12x_enabled')} />
      </GroupedList>

      <GroupedList header="Preços">
        <FormRow
          label="Preço mensal (R$)"
          input={{ ...text('price_brl_input'), inputMode: 'decimal', placeholder: '99.90' }}
        />
        <FormRow
          label="Preço anual (R$)"
          input={{ ...text('price_brl_annual_input'), inputMode: 'decimal', placeholder: '959.00' }}
        />
        <FormRow
          label="Parcela 12x (R$)"
          input={{
            ...text('pagarme_installment_cents_input'),
            inputMode: 'decimal',
            placeholder: '94.90',
          }}
        />
        <FormRow
          label="Ordem"
          input={{
            type: 'number',
            step: 1,
            min: 0,
            placeholder: '0',
            value: form.sort_order ?? '',
            onChange: (e) => setForm((f) => ({ ...f, sort_order: parseIntInput(e.target.value) })),
          }}
        />
      </GroupedList>

      <GroupedList header="Cobrança">
        <FormRow
          label="ID do produto Stripe"
          input={{ ...text('stripe_product_id'), placeholder: 'prod_...' }}
        />
        <FormRow
          label="ID do preço Stripe (mensal)"
          input={{ ...text('stripe_price_id'), placeholder: 'price_...' }}
        />
        <FormRow
          label="ID do preço Stripe (anual)"
          input={{ ...text('stripe_price_id_annual'), placeholder: 'price_...' }}
        />
        <FormRow
          label="ID do plano Pagar.me (anual)"
          input={{ ...text('pagarme_plan_id_annual'), placeholder: 'plan_...' }}
        />
      </GroupedList>

      <GroupedList header="Limites de recursos" footer="Deixe vazio para ilimitado (∞).">
        {RESOURCE_LIMIT_KEYS.map((key) => (
          <FormRow
            key={key}
            label={RESOURCE_LIMIT_LABELS[key]}
            input={{
              type: 'number',
              placeholder: '∞',
              value: form.resources[key] ?? '',
              onChange: (e) => setResource(key, e.target.value),
            }}
          />
        ))}
      </GroupedList>

      <GroupedList header={`Funcionalidades · ${enabledCount} de ${FEATURE_FLAG_KEYS.length}`}>
        {FEATURE_FLAG_KEYS.map((key) => (
          <Cell
            key={key}
            label={FEATURE_FLAG_LABELS[key]}
            switch={{
              checked: Boolean(form.features[key]),
              onCheckedChange: (checked) => setFeature(key, checked),
            }}
          />
        ))}
      </GroupedList>

      <GroupedList header="Limites de taxa" footer="Deixe vazio para ilimitado (∞).">
        {RATE_LIMIT_KEYS.map((key) => (
          <FormRow
            key={key}
            label={RATE_LIMIT_LABELS[key]}
            input={{
              type: 'number',
              placeholder: '∞',
              value: form.rates[key] ?? '',
              onChange: (e) => setRate(key, e.target.value),
            }}
          />
        ))}
      </GroupedList>

      {onDelete && (
        <GroupedList aria-label="Zona de perigo">
          <Cell
            label="Excluir plano"
            icon={<Trash2 size={18} />}
            destructive
            disabled={deleting}
            onClick={onDelete}
          />
        </GroupedList>
      )}
    </form>
  );
}

/** Empty means unlimited (null); anything else keeps the original parseInt behaviour. */
function parseLimit(raw: string): number | null {
  return raw === '' ? null : parseInt(raw, 10);
}

const FIELD = 'h-9 rounded-[10px] border-border bg-foreground/[0.08] text-sm shadow-none';
const MONO = '[font-family:ui-monospace,SFMono-Regular,Menlo,monospace]';

function Panel({ children }: { children: ReactNode }) {
  return <div className="rounded-[14px] bg-foreground/[0.06] px-[18px] py-3.5">{children}</div>;
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 ml-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
        {title}
      </h3>
      <Panel>{children}</Panel>
      {note && <p className="mt-1.5 ml-1 text-xs text-muted-foreground">{note}</p>}
    </section>
  );
}

function Grid({ cols, children }: { cols: string; children: ReactNode }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: cols.replaceAll('_', ' ') }}>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
