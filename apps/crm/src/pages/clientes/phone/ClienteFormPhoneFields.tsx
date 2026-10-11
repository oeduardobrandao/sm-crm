import { Controller, type UseFormReturn } from 'react-hook-form';
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
import '@/components/entity-list-phone/entityListPhone.css';

export interface ClienteFormPhoneValues {
  nome: string;
  email: string;
  telefone: string;
  plano: string;
  valor: string;
  diaPag: string;
  status: 'ativo' | 'pausado' | 'encerrado';
}

/**
 * The Add / Edit cliente fields on phones (FClienteForm mockup): grouped iOS rows with
 * the label on the left, same labels, validation and react-hook-form state as the
 * desktop fields. Rendered inside the existing dialog, which F0c turns into a sheet.
 */
export function ClienteFormPhoneFields({
  form,
  showValor,
  showStatus,
}: {
  form: UseFormReturn<ClienteFormPhoneValues>;
  showValor: boolean;
  showStatus: boolean;
}) {
  const { t } = useTranslation('clients');
  const { t: tc } = useTranslation();
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
          label={t('form.email')}
          input={{
            ...form.register('email'),
            type: 'email',
            inputMode: 'email',
            placeholder: 'contato@empresa.com',
          }}
          error={errors.email?.message}
        />
        <FormRow
          label={t('form.phone')}
          input={{ ...form.register('telefone'), type: 'tel', inputMode: 'tel' }}
          error={errors.telefone?.message}
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
        {showStatus && (
          <FormRow label={t('form.status')}>
            {(field) => (
              <Controller
                control={form.control}
                name="status"
                render={({ field: control }) => (
                  <Select value={control.value} onValueChange={control.onChange}>
                    <SelectTrigger
                      id={field.id}
                      aria-describedby={field['aria-describedby']}
                      className="phone-el-form-select"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ativo">{tc('status.ativo')}</SelectItem>
                      <SelectItem value="pausado">{tc('status.pausado')}</SelectItem>
                      <SelectItem value="encerrado">{tc('status.encerrado')}</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            )}
          </FormRow>
        )}
      </GroupedList>
    </div>
  );
}
