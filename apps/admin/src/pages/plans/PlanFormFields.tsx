import type { Dispatch, FormEvent, SetStateAction } from 'react';
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
  const text = (key: keyof FormState) => ({
    value: form[key] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value })),
  });
  const toggle = (key: 'is_default' | 'is_active' | 'pagarme_12x_enabled') => ({
    checked: form[key],
    onCheckedChange: (checked: boolean) => setForm((f) => ({ ...f, [key]: checked })),
  });
  const enabledCount = FEATURE_FLAG_KEYS.filter((k) => form.features[k]).length;

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
              onChange: (e) =>
                setForm((f) => ({
                  ...f,
                  resources: { ...f.resources, [key]: parseLimit(e.target.value) },
                })),
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
              onCheckedChange: (checked) =>
                setForm((f) => ({ ...f, features: { ...f.features, [key]: checked } })),
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
              onChange: (e) =>
                setForm((f) => ({
                  ...f,
                  rates: { ...f.rates, [key]: parseLimit(e.target.value) },
                })),
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
