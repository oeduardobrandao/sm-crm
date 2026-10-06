import { useWatch, type UseFormReturn } from 'react-hook-form';
import { addDays, differenceInCalendarDays, startOfDay } from 'date-fns';
import { DatePicker } from '@/components/ui/date-picker';
import { FormControl, FormField, FormItem } from '@/components/ui/form';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toDateOnlyString } from '../../tarefas/tarefasLogic';
import { opcaoDaRegra, rederivarRegra } from './agendaLogic';
import {
  HORARIOS,
  combinarDataHora,
  duracaoRotulo,
  hhmm,
  type EventoFormValues,
} from './eventoFormSchema';

const SUJO = { shouldDirty: true } as const;

/** The grid plus the current value when it is off the 15-min grid (API-made events). */
function opcoesHorario(atual: string): string[] {
  return HORARIOS.includes(atual) ? HORARIOS : [atual, ...HORARIOS];
}

export interface QuandoCamposProps {
  form: UseFormReturn<EventoFormValues>;
  /** Series tz when it differs from the browser's (edit only). */
  fusoDiferente?: string | null;
  /** Shows the "Quando" label above the start date. */
  rotulo?: boolean;
}

/** Start date, start/end times and (all-day or multi-day) end date, shared by
 *  the quick-create card and the full event form. Moving the start date or time
 *  keeps the duration; the date also re-derives the recurrence rule. */
export function QuandoCampos({ form, fusoDiferente = null, rotulo = true }: QuandoCamposProps) {
  const v = useWatch({ control: form.control }) as EventoFormValues;
  const { errors } = form.formState;

  const mudarDataInicio = (d: Date | undefined) => {
    if (!d) return;
    const atual = form.getValues();
    const nova = startOfDay(d);
    const delta = differenceInCalendarDays(nova, atual.data_inicio);
    form.setValue('data_inicio', nova, SUJO);
    form.setValue('data_fim', addDays(atual.data_fim, delta), SUJO);
    const regra = rederivarRegra(atual.repetir, atual.regra, nova);
    form.setValue('regra', regra, SUJO);
    form.setValue('repetir', opcaoDaRegra(regra, nova), SUJO);
  };

  const mudarHoraInicio = (h: string) => {
    const atual = form.getValues();
    const inicioAntes = combinarDataHora(atual.data_inicio, atual.hora_inicio);
    const fimAntes = combinarDataHora(atual.data_fim, atual.hora_fim);
    const duracao = fimAntes.getTime() - inicioAntes.getTime();
    const novoInicio = combinarDataHora(atual.data_inicio, h);
    const novoFim = new Date(novoInicio.getTime() + (duracao > 0 ? duracao : 60 * 60_000));
    form.setValue('hora_inicio', h, SUJO);
    form.setValue('data_fim', startOfDay(novoFim), SUJO);
    form.setValue('hora_fim', hhmm(novoFim), SUJO);
  };

  const diaInteiro = !!v.dia_inteiro;
  const erroFim = (diaInteiro ? errors.data_fim : errors.hora_fim)?.message;
  const dataInicio = v.data_inicio ?? new Date();
  const inicioCompleto = combinarDataHora(dataInicio, v.hora_inicio ?? '00:00');
  const fimEmOutroDia =
    !!v.data_fim && toDateOnlyString(v.data_fim) !== toDateOnlyString(dataInicio);

  const rotuloFim = (h: string) => {
    if (!v.data_fim) return h;
    const min = Math.round(
      (combinarDataHora(v.data_fim, h).getTime() - inicioCompleto.getTime()) / 60_000,
    );
    return min > 0 && min < 1440 ? `${h} (${duracaoRotulo(min)})` : h;
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-end gap-2.5">
        <div className="flex min-w-[180px] flex-[1.3] flex-col gap-2">
          {rotulo && <Label>Quando</Label>}
          <DatePicker
            value={v.data_inicio}
            onChange={mudarDataInicio}
            placeholder="Data de início"
            displayFormat="EEE, d 'de' MMM 'de' yyyy"
            clearable={false}
            className="mb-0 h-10 w-full"
          />
        </div>
        {!diaInteiro && (
          <div className="min-w-[96px] flex-[.8]">
            <Select value={v.hora_inicio} onValueChange={mudarHoraInicio}>
              <SelectTrigger aria-label="Hora de início" className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {opcoesHorario(v.hora_inicio ?? '').map((h) => (
                  <SelectItem key={h} value={h}>
                    {h}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <span className="pb-2.5 text-sm" style={{ color: 'var(--text-muted)' }}>
          até
        </span>
        {!diaInteiro && (
          <FormField
            control={form.control}
            name="hora_fim"
            render={({ field }) => (
              <FormItem className="min-w-[140px] flex-[.8]">
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger aria-label="Hora de fim" className="h-10">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent className="max-h-72">
                    {opcoesHorario(field.value).map((h) => (
                      <SelectItem key={h} value={h}>
                        {rotuloFim(h)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormItem>
            )}
          />
        )}
        {(diaInteiro || fimEmOutroDia) && (
          <FormField
            control={form.control}
            name="data_fim"
            render={({ field }) => (
              <FormItem className="min-w-[180px] flex-[1.3]">
                <DatePicker
                  value={field.value}
                  onChange={(d) => d && field.onChange(startOfDay(d))}
                  placeholder="Data de fim"
                  displayFormat="EEE, d 'de' MMM 'de' yyyy"
                  clearable={false}
                  className="mb-0 h-10 w-full"
                />
              </FormItem>
            )}
          />
        )}
      </div>
      {erroFim && (
        <p role="alert" className="text-[0.8rem] font-medium text-destructive">
          {erroFim}
        </p>
      )}
      {fusoDiferente && (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Horários no fuso {fusoDiferente}
        </p>
      )}
    </div>
  );
}
