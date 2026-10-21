import { useEffect, useId, useState } from 'react';
import { addMonths } from 'date-fns';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { AgendaRegra } from '@/store/agenda';
import { WEEKDAY_CHIPS, WEEKDAY_NAMES, unidadeIntervalo } from '../../tarefas/recorrenciaLogic';
import { descreverRegra } from './agendaLogic';
import {
  opcoesMensaisPersonalizadas,
  personalizadaParaRegra,
  regraParaPersonalizada,
  validarPersonalizada,
  type ModoMensal,
  type RecorrenciaPersonalizada,
} from './eventoFormSchema';

const FREQS: AgendaRegra['freq'][] = ['daily', 'weekly', 'monthly', 'yearly'];
/** Chips Sunday-first, as in the mockup (D S T Q Q S S). */
const DIAS = [0, 1, 2, 3, 4, 5, 6];

interface RecorrenciaPersonalizadaDialogProps {
  open: boolean;
  /** Start date of the event: weekday, day of month and ordinal come from it. */
  inicio: Date;
  /** Current rule to edit, or null to start from "weekly on the start weekday". */
  regra: AgendaRegra | null;
  onCancel: () => void;
  onConcluir: (regra: AgendaRegra) => void;
}

/** "Repetição personalizada" (spec: RecorrenciaPersonalizadaDialog). */
export function RecorrenciaPersonalizadaDialog({
  open,
  inicio,
  regra,
  onCancel,
  onConcluir,
}: RecorrenciaPersonalizadaDialogProps) {
  const nome = useId();
  const [s, setS] = useState<RecorrenciaPersonalizada>(() => regraParaPersonalizada(regra, inicio));

  // Seed on every opening from the rule the form holds now.
  useEffect(() => {
    if (open) setS(regraParaPersonalizada(regra, inicio));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = (p: Partial<RecorrenciaPersonalizada>) => setS((atual) => ({ ...atual, ...p }));
  const erro = validarPersonalizada(s, inicio);
  const resumo = erro ? null : descreverRegra(personalizadaParaRegra(s, inicio), inicio);
  const n = parseInt(s.intervalo, 10);
  const mensais = opcoesMensaisPersonalizadas(inicio);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto p-6 sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold tracking-normal">
            Repetição personalizada
          </DialogTitle>
          <DialogDescription className="sr-only">
            Defina de quanto em quanto tempo o evento se repete e quando termina.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-[18px]">
          <div className="flex flex-wrap items-center gap-2.5 text-sm">
            <label htmlFor={`${nome}-intervalo`}>Repetir a cada</label>
            <Input
              id={`${nome}-intervalo`}
              inputMode="numeric"
              value={s.intervalo}
              onChange={(e) => set({ intervalo: e.target.value })}
              className="h-10 w-16 text-center"
            />
            <Select value={s.freq} onValueChange={(v) => set({ freq: v as AgendaRegra['freq'] })}>
              <SelectTrigger aria-label="Unidade da repetição" className="h-10 w-auto min-w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FREQS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {unidadeIntervalo(f, Number.isNaN(n) ? 1 : n)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {s.freq === 'weekly' && (
            <div>
              <div className="mb-2 text-[13px] font-semibold">Nos dias</div>
              <div className="flex gap-1.5">
                {DIAS.map((d) => {
                  const on = s.dias_semana.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      aria-label={WEEKDAY_NAMES[d]}
                      onClick={() =>
                        set({
                          dias_semana: on
                            ? s.dias_semana.filter((x) => x !== d)
                            : [...s.dias_semana, d],
                        })
                      }
                      className={cn(
                        'h-9 w-9 rounded-full border text-[13px] font-semibold transition-colors',
                        on ? 'border-foreground bg-foreground text-background' : 'bg-background',
                      )}
                    >
                      {WEEKDAY_CHIPS[d]}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {s.freq === 'monthly' && (
            <Select value={s.mensal} onValueChange={(v) => set({ mensal: v as ModoMensal })}>
              <SelectTrigger aria-label="Dia do mês" className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {mensais.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <fieldset className="m-0 border-0 p-0">
            <legend className="mb-1 text-[13px] font-semibold">Termina</legend>
            <label className="flex items-center gap-2.5 py-2 text-sm">
              <input
                type="radio"
                name={`${nome}-fim`}
                checked={s.termina === 'nunca'}
                onChange={() => set({ termina: 'nunca' })}
                className="h-[18px] w-[18px]"
              />
              Nunca
            </label>
            <div className="flex items-center gap-2.5 py-2 text-sm">
              <label className="flex w-16 items-center gap-2.5">
                <input
                  type="radio"
                  name={`${nome}-fim`}
                  checked={s.termina === 'em'}
                  onChange={() => set({ termina: 'em', ate: s.ate ?? addMonths(inicio, 3) })}
                  className="h-[18px] w-[18px]"
                />
                Em
              </label>
              <DatePicker
                value={s.ate}
                onChange={(d) => set({ termina: 'em', ate: d })}
                placeholder="Data final"
                displayFormat="d 'de' MMM 'de' yyyy"
                clearable={false}
                disabled={s.termina !== 'em'}
                className="h-10"
              />
            </div>
            <div className="flex items-center gap-2.5 py-2 text-sm">
              <label className="flex w-16 items-center gap-2.5">
                <input
                  type="radio"
                  name={`${nome}-fim`}
                  checked={s.termina === 'apos'}
                  onChange={() => set({ termina: 'apos' })}
                  className="h-[18px] w-[18px]"
                />
                Após
              </label>
              <Input
                aria-label="Número de ocorrências"
                inputMode="numeric"
                value={s.contagem}
                disabled={s.termina !== 'apos'}
                onChange={(e) => set({ contagem: e.target.value })}
                className="h-10 w-16 text-center"
              />
              ocorrências
            </div>
          </fieldset>

          <div
            role={erro ? 'alert' : 'status'}
            className="rounded-[10px] px-3 py-2.5 text-[13px]"
            style={{
              background: 'var(--surface-1)',
              color: erro ? 'var(--danger-text)' : 'var(--text-muted)',
            }}
          >
            {erro ?? resumo}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={erro !== null}
            onClick={() => {
              if (validarPersonalizada(s, inicio) === null) {
                onConcluir(personalizadaParaRegra(s, inicio));
              }
            }}
          >
            Concluir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
