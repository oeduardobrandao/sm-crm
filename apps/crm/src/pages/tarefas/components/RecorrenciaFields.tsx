import type { UseFormReturn } from 'react-hook-form';
import { Repeat } from 'lucide-react';
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
}

const REPETIR_ORDER: RepetirValor[] = ['never', 'daily', 'weekly', 'monthly', 'yearly'];

/** The "Repetir" section of TarefaFormDialog. Pure form UI: the rule is read
 *  back with regraFromForm() at submit time; no next-date math on the client. */
export function RecorrenciaFields({
  form,
  landing,
  disabled,
  disabledHint,
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
