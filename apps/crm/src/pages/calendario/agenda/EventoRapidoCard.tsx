import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { addDays, startOfDay } from 'date-fns';
import { Clock, MapPin, Users, X } from 'lucide-react';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useAuth } from '@/context/AuthContext';
import type { AgendaTipo } from '@/store/agenda';
import { getWorkspaceUsers } from '@/store/workspace';
import { TIPO_COR, TIPO_LABEL } from './agendaLogic';
import {
  MAX_PARTICIPANTES,
  combinarDataHora,
  eventoFormSchema,
  valoresIniciaisCriar,
  type EventoFormValues,
} from './eventoFormSchema';
import { ancoraVirtual } from './EventoPopover';
import { PessoasCombobox, type PessoaEquipe } from './PessoasCombobox';
import { QuandoCampos } from './QuandoCampos';
import { useCriarEvento } from './useCriarEvento';

export interface RascunhoEvento {
  inicio: Date;
  /** Exclusive for all-day drafts (FullCalendar). */
  fim: Date;
  diaInteiro: boolean;
  titulo: string;
  tipo: AgendaTipo;
}

export interface EventoRapidoCardProps {
  /** `fim` is exclusive for all-day selections (FullCalendar). */
  inicial: { inicio: Date; fim: Date; diaInteiro: boolean };
  /** The draft chip on the grid (or the selected day's cell). */
  anchor: HTMLElement;
  /** Live title/time/tipo so the draft chip follows the card. */
  onRascunhoChange: (r: RascunhoEvento) => void;
  /** Discard, no confirm (Google behaviour). */
  onClose: () => void;
  onMaisOpcoes: (valores: EventoFormValues) => void;
}

const TIPOS = Object.keys(TIPO_LABEL) as AgendaTipo[];
const ICONE = { size: 18, strokeWidth: 1.75 } as const;

function Linha({ icone, children }: { icone: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span
        className="flex h-10 w-[18px] shrink-0 items-center"
        style={{ color: 'var(--text-light)' }}
        aria-hidden="true"
      >
        {icone}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Google-Calendar-style quick create, next to the draft chip of the selected
 *  slot. Short by design: no internal scroll. Everything else lives in the
 *  full-size editor behind "Mais opções". */
export function EventoRapidoCard({
  inicial,
  anchor,
  onRascunhoChange,
  onClose,
  onMaisOpcoes,
}: EventoRapidoCardProps) {
  const { user } = useAuth();
  const form = useForm<EventoFormValues>({
    resolver: zodResolver(eventoFormSchema),
    defaultValues: valoresIniciaisCriar(inicial),
  });
  const criar = useCriarEvento({ onCriado: onClose });
  const salvando = criar.isPending;
  useUnsavedWork(form.formState.isDirty || salvando);

  const { data: usuarios = [] } = useQuery({
    queryKey: ['workspace-users'],
    queryFn: getWorkspaceUsers,
  });
  const organizadorId = user?.id ?? null;
  const pessoas: PessoaEquipe[] = useMemo(
    () =>
      (usuarios as { id: string; nome: string | null; avatar_url?: string | null }[])
        .filter((u) => u.id && u.id !== organizadorId)
        .map((u) => ({ id: u.id, nome: u.nome || 'Sem nome', avatar_url: u.avatar_url ?? null })),
    [usuarios, organizadorId],
  );

  const virtualRef = useMemo(() => ({ current: ancoraVirtual(anchor) }), [anchor]);

  // ---- Live draft: the chip on the grid follows the title, tipo and time ----
  const onRascunhoChangeRef = useRef(onRascunhoChange);
  useEffect(() => {
    onRascunhoChangeRef.current = onRascunhoChange;
  }, [onRascunhoChange]);

  const [titulo, tipo, dataInicio, horaInicio, dataFim, horaFim, diaInteiro] = useWatch({
    control: form.control,
    name: ['titulo', 'tipo', 'data_inicio', 'hora_inicio', 'data_fim', 'hora_fim', 'dia_inteiro'],
  });
  const dataInicioMs = dataInicio?.getTime();
  const dataFimMs = dataFim?.getTime();
  useEffect(() => {
    if (dataInicioMs === undefined || dataFimMs === undefined) return;
    const di = new Date(dataInicioMs);
    const df = new Date(dataFimMs);
    const inicio = diaInteiro ? startOfDay(di) : combinarDataHora(di, horaInicio);
    const fim = diaInteiro ? addDays(startOfDay(df), 1) : combinarDataHora(df, horaFim);
    if (fim.getTime() <= inicio.getTime()) return;
    onRascunhoChangeRef.current({ inicio, fim, diaInteiro: !!diaInteiro, titulo, tipo });
  }, [titulo, tipo, dataInicioMs, horaInicio, dataFimMs, horaFim, diaInteiro]);

  const fechar = () => {
    if (!salvando) onClose();
  };
  const maisOpcoes = () => {
    if (!salvando) onMaisOpcoes(form.getValues());
  };
  const onSubmit = form.handleSubmit((v) => criar.mutate(v));

  return (
    <Popover open onOpenChange={(aberto) => !aberto && fechar()}>
      <PopoverAnchor virtualRef={virtualRef} />
      <PopoverContent
        side="right"
        align="start"
        sideOffset={8}
        collisionPadding={16}
        updatePositionStrategy="always"
        aria-label="Novo evento"
        className="agenda-rapido w-[448px] max-w-[calc(100vw-32px)] p-0"
        style={{
          background: 'var(--card-bg)',
          borderColor: 'var(--border-color)',
          borderRadius: 12,
          color: 'var(--text-main)',
          boxShadow: 'var(--shadow-popover, 0 12px 32px rgba(0, 0, 0, 0.16))',
        }}
        // The title takes focus, not the close button that precedes it.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          form.setFocus('titulo');
        }}
        // Pressing on (or focusing) the draft chip itself keeps the card (Google
        // behaviour); anywhere else on the grid closes it and may start a new
        // selection. onInteractOutside covers both the pointer and focus paths.
        onInteractOutside={(e) => {
          const alvo = e.target as Element | null;
          if (alvo?.closest?.('[data-ocorrencia-id="rascunho"]')) e.preventDefault();
        }}
      >
        <Form {...form}>
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3 px-5 pb-4 pt-2">
            <div className="-mr-3 flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="mb-0 h-8 w-8 rounded-lg"
                style={{ color: 'var(--text-muted)' }}
                aria-label="Fechar"
                disabled={salvando}
                onClick={fechar}
              >
                <X aria-hidden="true" />
              </Button>
            </div>

            <FormField
              control={form.control}
              name="titulo"
              render={({ field }) => (
                <FormItem className="pl-[30px]">
                  <FormControl>
                    <input
                      {...field}
                      aria-label="Título"
                      placeholder="Adicionar título"
                      autoFocus
                      maxLength={200}
                      autoComplete="off"
                      className="agenda-rapido__titulo"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="tipo"
              render={({ field }) => (
                <ToggleGroup
                  type="single"
                  aria-label="Tipo"
                  className="agenda-rapido__tipos"
                  value={field.value}
                  // Radix fires '' when the active pill is clicked again: keep one.
                  onValueChange={(t) => t && field.onChange(t as AgendaTipo)}
                >
                  {TIPOS.map((t) => (
                    <ToggleGroupItem
                      key={t}
                      value={t}
                      aria-label={TIPO_LABEL[t]}
                      className="agenda-rapido__tipo"
                    >
                      <span
                        className="agenda-rapido__tipo-dot"
                        style={{ background: TIPO_COR[t] }}
                        aria-hidden="true"
                      />
                      {TIPO_LABEL[t]}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              )}
            />

            <Linha icone={<Clock {...ICONE} />}>
              <div className="agenda-rapido__quando">
                <QuandoCampos form={form} rotulo={false} />
              </div>
              <button type="button" className="agenda-rapido__repetir" onClick={maisOpcoes}>
                Não se repete
              </button>
            </Linha>

            <Linha icone={<Users {...ICONE} />}>
              <FormField
                control={form.control}
                name="participantes"
                render={({ field }) => (
                  <FormItem>
                    <PessoasCombobox
                      pessoas={pessoas}
                      value={field.value}
                      onChange={field.onChange}
                      max={MAX_PARTICIPANTES}
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />
            </Linha>

            <Linha icone={<MapPin {...ICONE} />}>
              <FormField
                control={form.control}
                name="local"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Input
                        {...field}
                        aria-label="Local"
                        placeholder="Adicionar local"
                        maxLength={300}
                        className="h-10"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </Linha>

            <div className="mt-1 flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                className="mb-0"
                disabled={salvando}
                onClick={maisOpcoes}
              >
                Mais opções
              </Button>
              <Button type="submit" className="mb-0" disabled={salvando}>
                Salvar
              </Button>
            </div>
          </form>
        </Form>
      </PopoverContent>
    </Popover>
  );
}
