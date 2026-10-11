import type { UseFormReturn } from 'react-hook-form';
import { Check, Repeat } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { DatePicker } from '@/components/ui/date-picker';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import { FormRow } from '@/components/mobile/FormRow';
import { PickerCell } from '@/components/mobile/PickerSheet';
import { PhoneDateRow } from '../phone/PhoneDateRow';
import {
  describeRecorrencia,
  modoLabel,
  regraFromForm,
  REPETIR_LABELS,
  unidadeIntervalo,
  WEEKDAY_CHIPS,
  WEEKDAY_NAMES,
  type RepetirValor,
} from '../recorrenciaLogic';
import type { TarefaFormValues } from './tarefaFormSchema';

export interface RecorrenciaFieldsProps {
  form: UseFormReturn<TarefaFormValues>;
  /** Series landing day/month when editing an occurrence; null derives from Prazo. */
  landing: { dia_mes: number | null; mes: number | null } | null;
  disabled?: boolean;
  /** Shown under the select when disabled. */
  disabledHint?: string;
  /** `phone`: grouped rows (picker row, native date, day chips) inside the phone form. */
  layout?: 'default' | 'phone';
}

const REPETIR_ORDER: RepetirValor[] = ['never', 'daily', 'weekly', 'monthly', 'yearly'];

/** The "Repetir" section of TarefaFormDialog. Pure form UI: the rule is read
 *  back with regraFromForm() at submit time; no next-date math on the client. */
export function RecorrenciaFields({
  form,
  landing,
  disabled,
  disabledHint,
  layout = 'default',
}: RecorrenciaFieldsProps) {
  const repetir = form.watch('repetir');
  const intervalo = form.watch('intervalo');
  const diasSemana = form.watch('dias_semana');
  const fim = form.watch('fim');
  const modo = form.watch('modo');
  const dataLimite = form.watch('data_limite');
  const serieNova = form.watch('serie_nova');

  const n = parseInt(intervalo, 10);
  const nValido = /^\d{1,2}$/.test(intervalo.trim()) && n >= 1 && n <= 99;
  // Prazo seeds the landing day/month of a new series; an occurrence keeps its own.
  const base = dataLimite ?? (landing ? new Date() : null);
  const regra = base
    ? regraFromForm(
        { repetir, intervalo, dias_semana: diasSemana, fim, modo, serie_nova: serieNova },
        base,
        landing,
      )
    : null;
  // The summary only renders for a complete rule: an emptied interval would read
  // "A cada NaN dias" and a weekly rule with no chip selected "Toda " (dangling).
  const regraCompleta = !!regra && nValido && (repetir !== 'weekly' || diasSemana.length > 0);

  if (layout === 'phone') {
    const errors = form.formState.errors;
    return (
      <>
        <GroupedList header="Repetição">
          <FormField
            control={form.control}
            name="repetir"
            render={({ field }) => (
              <PickerCell<RepetirValor>
                label="Repetir"
                icon={<Repeat aria-hidden="true" />}
                options={REPETIR_ORDER.map((v) => ({ value: v, label: REPETIR_LABELS[v] }))}
                value={field.value}
                onChange={(v) => {
                  if (v) field.onChange(v);
                }}
                disabled={disabled}
                subtitle={disabled ? disabledHint : undefined}
              />
            )}
          />
          {repetir !== 'never' && (
            <>
              <FormRow
                label="A cada"
                error={errors.intervalo?.message}
                accessory={
                  <span className="phone-tar-form__unit">
                    {unidadeIntervalo(repetir, nValido ? n : 2)}
                  </span>
                }
              >
                {(fieldProps) => (
                  <input
                    {...fieldProps}
                    {...form.register('intervalo')}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={99}
                    aria-label="Intervalo"
                    className="phone-tar-form__interval"
                  />
                )}
              </FormRow>
              {repetir === 'weekly' && (
                <FormField
                  control={form.control}
                  name="dias_semana"
                  render={({ field }) => (
                    <li className="phone-cell phone-form-row">
                      <div
                        role="group"
                        aria-label="Dias da semana"
                        className="phone-tar-form__weekdays"
                      >
                        {WEEKDAY_CHIPS.map((letter, day) => {
                          const on = field.value.includes(day);
                          return (
                            <button
                              key={day}
                              type="button"
                              aria-label={WEEKDAY_NAMES[day]}
                              aria-pressed={on}
                              className="phone-tar-form__weekday"
                              onClick={() =>
                                field.onChange(
                                  on ? field.value.filter((d) => d !== day) : [...field.value, day],
                                )
                              }
                            >
                              {letter}
                            </button>
                          );
                        })}
                      </div>
                      {errors.dias_semana?.message && (
                        <p className="phone-form-row__foot" role="alert">
                          {errors.dias_semana.message}
                        </p>
                      )}
                    </li>
                  )}
                />
              )}
              {(repetir === 'monthly' || repetir === 'yearly') && regra && (
                <Cell
                  label={
                    repetir === 'monthly'
                      ? `Todo dia ${regra.dia_mes}${(regra.dia_mes ?? 0) > 28 ? ' (ou último dia)' : ''}`
                      : `Todo ano em ${String(regra.dia_mes).padStart(2, '0')}/${String(regra.mes).padStart(2, '0')}`
                  }
                />
              )}
              <FormField
                control={form.control}
                name="fim"
                render={({ field }) => (
                  <PhoneDateRow
                    label="Termina em"
                    value={field.value}
                    onChange={field.onChange}
                    emptyLabel="Nunca"
                    error={errors.fim?.message}
                  />
                )}
              />
            </>
          )}
        </GroupedList>

        {repetir !== 'never' && (
          <FormField
            control={form.control}
            name="modo"
            render={({ field }) => (
              <GroupedList
                header="Modo de geração"
                footer="Ao concluir: a próxima tarefa só aparece quando esta for concluída. Toda data: a tarefa aparece na data, mesmo com a anterior aberta."
              >
                {(
                  [
                    ['ao_concluir', 'Criar a próxima ao concluir'],
                    ['calendario', 'Criar em toda data da regra'],
                  ] as const
                ).map(([value, label]) => (
                  <Cell
                    key={value}
                    label={label}
                    aria-pressed={field.value === value}
                    accessory={
                      field.value === value ? (
                        <Check className="phone-check" aria-hidden="true" />
                      ) : undefined
                    }
                    onClick={() => field.onChange(value)}
                  />
                ))}
              </GroupedList>
            )}
          />
        )}

        {repetir !== 'never' && regra && regraCompleta && (
          <p className="phone-tar-form__summary" data-testid="recorrencia-resumo">
            {describeRecorrencia(regra)}
            {' · '}
            {modoLabel(modo)}
          </p>
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <FormField
        control={form.control}
        name="repetir"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="flex items-center gap-1.5">
              <Repeat className="h-3.5 w-3.5" aria-hidden="true" />
              Repetir
            </FormLabel>
            <Select value={field.value} onValueChange={field.onChange} disabled={disabled}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {REPETIR_ORDER.map((v) => (
                  <SelectItem key={v} value={v}>
                    {REPETIR_LABELS[v]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {disabled && disabledHint && (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {disabledHint}
              </p>
            )}
            <FormMessage />
          </FormItem>
        )}
      />

      {repetir !== 'never' && (
        <>
          <FormField
            control={form.control}
            name="intervalo"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center gap-2 text-sm">
                  <span>a cada</span>
                  <FormControl>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={99}
                      className="w-16 h-8"
                      aria-label="Intervalo"
                      {...field}
                    />
                  </FormControl>
                  <span>{unidadeIntervalo(repetir, nValido ? n : 2)}</span>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          {repetir === 'weekly' && (
            <FormField
              control={form.control}
              name="dias_semana"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <ToggleGroup
                      type="multiple"
                      variant="outline"
                      aria-label="Dias da semana"
                      className="justify-start"
                      value={field.value.map(String)}
                      onValueChange={(vals: string[]) => field.onChange(vals.map(Number))}
                    >
                      {WEEKDAY_CHIPS.map((letter, day) => (
                        <ToggleGroupItem
                          key={day}
                          value={String(day)}
                          aria-label={WEEKDAY_NAMES[day]}
                          className="h-8 w-8 min-w-0 rounded-full px-0 text-xs"
                        >
                          {letter}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          {(repetir === 'monthly' || repetir === 'yearly') && regra && (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {repetir === 'monthly'
                ? `Todo dia ${regra.dia_mes}${(regra.dia_mes ?? 0) > 28 ? ' (ou último dia)' : ''}`
                : `Todo ano em ${String(regra.dia_mes).padStart(2, '0')}/${String(regra.mes).padStart(2, '0')}`}
            </p>
          )}

          <FormField
            control={form.control}
            name="fim"
            render={({ field }) => (
              <FormItem className="flex flex-col">
                <FormLabel>Termina em</FormLabel>
                <FormControl>
                  <DatePicker value={field.value} onChange={field.onChange} placeholder="Nunca" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="modo"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    aria-label="Modo de geração"
                    className="grid grid-cols-2 gap-2"
                    value={field.value}
                    onValueChange={(v: string) => {
                      if (v) field.onChange(v);
                    }}
                  >
                    <ToggleGroupItem
                      value="ao_concluir"
                      className="h-auto min-h-9 min-w-0 py-1.5 text-center"
                    >
                      Criar a próxima ao concluir
                    </ToggleGroupItem>
                    <ToggleGroupItem
                      value="calendario"
                      className="h-auto min-h-9 min-w-0 py-1.5 text-center"
                    >
                      Criar em toda data da regra
                    </ToggleGroupItem>
                  </ToggleGroup>
                </FormControl>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Ao concluir: a próxima tarefa só aparece quando esta for concluída. Toda data: a
                  tarefa aparece na data, mesmo com a anterior aberta.
                </p>
              </FormItem>
            )}
          />

          {regra && regraCompleta && (
            <p className="text-sm font-medium" data-testid="recorrencia-resumo">
              {describeRecorrencia(regra)}
              {' · '}
              {modoLabel(modo)}
            </p>
          )}
        </>
      )}
    </div>
  );
}
