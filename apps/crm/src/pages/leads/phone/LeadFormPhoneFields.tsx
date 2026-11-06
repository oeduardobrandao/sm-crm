import type { ReactNode } from 'react';
import {
  Controller,
  type Control,
  type FieldPath,
  type FieldValues,
  type UseFormReturn,
} from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormRow } from '@/components/mobile/FormRow';
import { GroupedList } from '@/components/mobile/GroupedList';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Lead } from '@/store';
import {
  CANAL_KEYS,
  FATURAMENTO_DB_VALUES,
  FATURAMENTO_KEYS,
  LEAD_STATUS_KEYS,
} from '../leadOptions';
import '@/components/entity-list-phone/entityListPhone.css';

export interface LeadFormPhoneValues {
  nome: string;
  email: string;
  instagram: string;
  canal: string;
  especialidade: string;
  faturamento: string;
  tags: string;
  notas: string;
  status: Lead['status'];
}

export interface ConvertFormPhoneValues {
  nome: string;
  email: string;
  telefone: string;
  plano: string;
  valor: string;
  diaPag: string;
}

/** A shadcn Select as the control of an inline FormRow, bound to a form field. */
function SelectRow<T extends FieldValues>({
  label,
  name,
  control,
  placeholder,
  children,
}: {
  label: string;
  name: FieldPath<T>;
  control: Control<T>;
  placeholder?: string;
  children: ReactNode;
}) {
  return (
    <FormRow label={label}>
      {(field) => (
        <Controller
          control={control}
          name={name}
          render={({ field: ctl }) => (
            <Select value={ctl.value as string} onValueChange={ctl.onChange}>
              <SelectTrigger
                id={field.id}
                aria-describedby={field['aria-describedby']}
                className="phone-el-form-select"
              >
                <SelectValue placeholder={placeholder} />
              </SelectTrigger>
              <SelectContent>{children}</SelectContent>
            </Select>
          )}
        />
      )}
    </FormRow>
  );
}

/**
 * The Novo / Editar lead fields on phones: grouped iOS rows with the desktop's labels,
 * validation and react-hook-form state. Rendered inside the existing dialog (F0c turns
 * it into a sheet).
 */
export function LeadFormPhoneFields({
  form,
  showStatus,
}: {
  form: UseFormReturn<LeadFormPhoneValues>;
  showStatus: boolean;
}) {
  const { t } = useTranslation('leads');
  const { t: tc } = useTranslation();
  const { errors } = form.formState;
  return (
    <div className="phone-kit phone-el-form">
      <GroupedList header="Contato">
        <FormRow
          label={t('form.name')}
          input={{ ...form.register('nome'), autoComplete: 'off' }}
          error={errors.nome?.message}
        />
        <FormRow
          label={t('form.email')}
          input={{ ...form.register('email'), type: 'email', inputMode: 'email' }}
          error={errors.email?.message}
        />
        <FormRow
          label={t('form.instagram')}
          input={{
            ...form.register('instagram'),
            placeholder: t('form.instagramPlaceholder'),
            autoCapitalize: 'none',
          }}
        />
      </GroupedList>
      <GroupedList header="Perfil">
        <SelectRow<LeadFormPhoneValues>
          label={t('form.channel')}
          name="canal"
          control={form.control}
          placeholder={t('form.selectPlaceholder')}
        >
          {CANAL_KEYS.map((c) => (
            <SelectItem key={c} value={c}>
              {t(`channels.${c}`)}
            </SelectItem>
          ))}
        </SelectRow>
        <FormRow label={t('form.specialty')} input={form.register('especialidade')} />
        <SelectRow<LeadFormPhoneValues>
          label={t('form.revenue')}
          name="faturamento"
          control={form.control}
          placeholder={t('form.selectPlaceholder')}
        >
          {FATURAMENTO_KEYS.map((k) => (
            <SelectItem key={k} value={FATURAMENTO_DB_VALUES[k]}>
              {t(`revenue.${k}`)}
            </SelectItem>
          ))}
        </SelectRow>
        <FormRow
          label={t('form.tags')}
          input={{ ...form.register('tags'), placeholder: t('form.tagsPlaceholder') }}
        />
        {showStatus && (
          <SelectRow<LeadFormPhoneValues>
            label={t('form.status')}
            name="status"
            control={form.control}
          >
            {LEAD_STATUS_KEYS.map((v) => (
              <SelectItem key={v} value={v}>
                {tc(`status.${v}`)}
              </SelectItem>
            ))}
          </SelectRow>
        )}
      </GroupedList>
      <GroupedList>
        <FormRow label={t('form.notes')} textarea={{ ...form.register('notas'), rows: 3 }} />
      </GroupedList>
    </div>
  );
}

/** The "Converter em cliente" fields on phones, same labels and rules as the desktop. */
export function ConvertFormPhoneFields({
  form,
  showValor,
}: {
  form: UseFormReturn<ConvertFormPhoneValues>;
  showValor: boolean;
}) {
  const { t } = useTranslation('leads');
  const { errors } = form.formState;
  return (
    <div className="phone-kit phone-el-form">
      <GroupedList header="Cliente">
        <FormRow
          label={t('form.name')}
          input={{ ...form.register('nome'), autoComplete: 'off' }}
          error={errors.nome?.message}
        />
        <FormRow
          label={`${t('form.email')} (opcional)`}
          input={{ ...form.register('email'), type: 'email', inputMode: 'email' }}
          error={errors.email?.message}
        />
        <FormRow
          label={t('form.phone')}
          input={{ ...form.register('telefone'), type: 'tel', inputMode: 'tel' }}
        />
      </GroupedList>
      <GroupedList header="Contrato">
        <FormRow label={t('form.plan')} input={form.register('plano')} />
        {showValor && (
          <FormRow
            label={t('form.monthlyValue')}
            input={{
              ...form.register('valor'),
              type: 'number',
              min: 0,
              step: 0.01,
              inputMode: 'decimal',
            }}
            error={errors.valor?.message}
          />
        )}
        <FormRow
          label={t('form.paymentDay')}
          input={{
            ...form.register('diaPag'),
            type: 'number',
            min: 1,
            max: 31,
            inputMode: 'numeric',
          }}
          error={errors.diaPag?.message}
        />
      </GroupedList>
    </div>
  );
}
