import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { startOfDay } from 'date-fns';
import {
  AlignLeft,
  Bell,
  Building2,
  Clock,
  Lock,
  MapPin,
  Plus,
  Repeat,
  Tag,
  Video,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  CONFIRM_CLOSE_DISCARD,
  CONFIRM_CLOSE_KEEP_EDITING,
  CONFIRM_CLOSE_MSG,
  CONFIRM_CLOSE_TITLE,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/context/AuthContext';
import {
  AGENDA_QUERY_KEY,
  editarEvento,
  ehAgendaNaoExiste,
  formatAgendaError,
  type AgendaEscopo,
  type AgendaEventoPayload,
  type AgendaOcorrencia,
  type AgendaRegra,
  type AgendaTipo,
} from '@/store/agenda';
import { getClientes, sortClientesByNome } from '@/store/clients';
import { getWorkspaceUsers } from '@/store/workspace';
import {
  LEMBRETES_DIA_INTEIRO,
  LEMBRETES_HORARIO,
  TIPO_COR,
  TIPO_LABEL,
  fusoDoNavegador,
  opcaoDaRegra,
  rotuloLembrete,
  type RepetirOpcaoId,
} from './agendaLogic';
import {
  MAX_LEMBRETES,
  MAX_PARTICIPANTES,
  camposDeSerieAlterados,
  chavesAlteradas,
  combinarDataHora,
  eventoFormSchema,
  mesmasPessoas,
  montarPayload,
  montarPayloadEdicao,
  motivoSerie,
  regraAcompanhouData,
  hhmm,
  valoresDeOcorrencia,
  valoresIniciaisCriar,
  type CampoSerie,
  type EventoFormValues,
} from './eventoFormSchema';
import { EscopoEventoDialog } from './EscopoEventoDialog';
import { PessoasCombobox, type PessoaEquipe } from './PessoasCombobox';
import { LocalAutocomplete } from './LocalAutocomplete';
import { RecorrenciaPersonalizadaDialog } from './RecorrenciaPersonalizadaDialog';
import { QuandoCampos } from './QuandoCampos';
import { RepetirSelect } from './RepetirSelect';
import { useCriarEvento } from './useCriarEvento';

export type EventoFormDialogProps =
  | {
      open: boolean;
      onOpenChange: (open: boolean) => void;
      modo: 'criar';
      /** `fim` is exclusive for all-day selections (FullCalendar). */
      inicial: { inicio: Date; fim: Date; diaInteiro: boolean };
      /** Values typed in the quick card. Read once when the dialog opens; the
       *  fields it carries start dirty so closing asks to discard. */
      rascunho?: Partial<EventoFormValues>;
    }
  | {
      open: boolean;
      onOpenChange: (open: boolean) => void;
      modo: 'editar';
      ocorrencia: AgendaOcorrencia;
    };

const TIPOS = Object.keys(TIPO_LABEL) as AgendaTipo[];
const SUJO = { shouldDirty: true } as const;

/** `Partial` values without the explicit `undefined`s, so a spread never blanks a field. */
function semUndefined(r: Partial<EventoFormValues>): Partial<EventoFormValues> {
  return Object.fromEntries(
    Object.entries(r).filter(([, valor]) => valor !== undefined),
  ) as Partial<EventoFormValues>;
}
/** The PopoverContent/SelectContent layer. DropdownMenuContent defaults to
 *  9011, the same as DialogContent, so the reminders menu is lifted to it. */
const MENU_SOBRE_DIALOG_Z = 'z-[9012]';
/** Horizontal page padding shared by the top bar, the "quando" block and the body. */
const GUTTER = 'clamp(1rem, 3vw, 2.5rem)';

/** A form row led by a muted icon column, like Google Calendar's editor. `topo` pins the
 *  icon to the first field row (below a label); `centro` centers it on a single-line row. */
function Linha({
  icone: Icone,
  alinhar = 'topo',
  children,
}: {
  icone: LucideIcon;
  alinhar?: 'topo' | 'centro';
  children: React.ReactNode;
}) {
  return (
    <div
      className={`grid grid-cols-[18px_minmax(0,1fr)] gap-x-3 ${alinhar === 'centro' ? 'items-center' : 'items-start'}`}
    >
      <Icone
        aria-hidden
        className={`h-[18px] w-[18px] ${alinhar === 'topo' ? 'mt-7' : ''}`}
        style={{ color: 'var(--text-muted)' }}
      />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Snapshot taken when the dialog opens; the edit payload diffs against it. */
interface Base {
  antes: AgendaEventoPayload;
  opcao: RepetirOpcaoId;
  regra: AgendaRegra | null;
  participantes: string[];
}

interface EscopoPendente {
  depois: AgendaEventoPayload;
  participantes: string[] | null;
  campos: CampoSerie[];
}

/** Criar / editar evento (spec: EventoFormDialog). On create, dates and times
 *  are the browser's wall clock; on edit, the series tz's (emFuso). */
export function EventoFormDialog(props: EventoFormDialogProps) {
  const { open, onOpenChange } = props;
  const ocorrencia = props.modo === 'editar' ? props.ocorrencia : null;
  const inicial = props.modo === 'criar' ? props.inicial : null;
  const rascunho = props.modo === 'criar' ? props.rascunho : undefined;
  const qc = useQueryClient();
  const { user } = useAuth();
  const ids = useId();

  const form = useForm<EventoFormValues>({
    resolver: zodResolver(eventoFormSchema),
    defaultValues: ocorrencia
      ? valoresDeOcorrencia(ocorrencia)
      : valoresIniciaisCriar(inicial ?? { inicio: new Date(), fim: new Date(), diaInteiro: false }),
  });
  const base = useRef<Base | null>(null);
  const [escopo, setEscopo] = useState<EscopoPendente | null>(null);
  const [personalizar, setPersonalizar] = useState(false);
  const [confirmarCancelar, setConfirmarCancelar] = useState(false);

  // Inline `inicial` objects change identity every parent render: key on primitives.
  const inicioMs = inicial?.inicio.getTime();
  const fimMs = inicial?.fim.getTime();
  const diaInteiroInicial = inicial?.diaInteiro;
  const ocorrenciaId = ocorrencia?.ocorrencia_id;
  // Declared before the reset effect so a draft arriving with `open` is already in the ref when
  // the reset runs. Kept out of the reset's deps: a new object identity must not wipe edits.
  const rascunhoRef = useRef(rascunho);
  useEffect(() => {
    rascunhoRef.current = rascunho;
  }, [rascunho]);
  useEffect(() => {
    if (!open) return;
    const valores = ocorrencia
      ? valoresDeOcorrencia(ocorrencia)
      : valoresIniciaisCriar({
          inicio: new Date(inicioMs ?? Date.now()),
          fim: new Date(fimMs ?? Date.now()),
          diaInteiro: !!diaInteiroInicial,
        });
    form.reset(valores);
    base.current = {
      antes: montarPayload(valores),
      opcao: valores.repetir,
      regra: valores.regra,
      participantes: valores.participantes,
    };
    // Values carried over from the quick card start dirty against the defaults.
    if (!ocorrencia && rascunhoRef.current) {
      form.reset({ ...valores, ...semUndefined(rascunhoRef.current) }, { keepDefaultValues: true });
    }
    setEscopo(null);
    setPersonalizar(false);
    setConfirmarCancelar(false);
    // `ocorrencia` is read through its id on purpose (a refetch must not reset edits).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ocorrenciaId, inicioMs, fimMs, diaInteiroInicial, form]);

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: getClientes,
    enabled: open,
  });
  const { data: usuarios = [] } = useQuery({
    queryKey: ['workspace-users'],
    queryFn: getWorkspaceUsers,
    enabled: open,
  });

  const organizadorId = ocorrencia ? ocorrencia.organizador_id : (user?.id ?? null);
  const pessoas: PessoaEquipe[] = useMemo(
    () =>
      (usuarios as { id: string; nome: string | null; avatar_url?: string | null }[])
        .filter((u) => u.id && u.id !== organizadorId)
        .map((u) => ({ id: u.id, nome: u.nome || 'Sem nome', avatar_url: u.avatar_url ?? null })),
    [usuarios, organizadorId],
  );

  const v = useWatch({ control: form.control }) as EventoFormValues;
  const clienteAtual = ocorrencia?.cliente_id ?? null;
  const clientesVisiveis = useMemo(
    () =>
      sortClientesByNome(
        clientes.filter((c) => c.id != null && (c.status === 'ativo' || c.id === clienteAtual)),
      ),
    [clientes, clienteAtual],
  );

  const fechar = () => onOpenChange(false);

  const terminar = () => {
    void qc.invalidateQueries({ queryKey: [AGENDA_QUERY_KEY] });
  };

  const tratarErro = (err: unknown) => {
    toast.error(formatAgendaError(err));
    if (ehAgendaNaoExiste(err)) {
      setEscopo(null);
      terminar();
      fechar();
    }
  };

  const criar = useCriarEvento({ onCriado: fechar });

  const editar = useMutation({
    mutationFn: (p: {
      escopo: AgendaEscopo;
      payload: Partial<AgendaEventoPayload>;
      participantes: string[] | null;
    }) => editarEvento(ocorrencia!.ocorrencia_id, p.escopo, p.payload, p.participantes),
    // The returned occurrence id is not used: it can be null when a one-off moves
    // past the materialized horizon (today + 24 months), like on create.
    onSuccess: () => {
      terminar();
      toast.success('Evento atualizado');
      setEscopo(null);
      fechar();
    },
    onError: tratarErro,
  });

  const salvando = criar.isPending || editar.isPending;
  const { isDirty } = form.formState;

  const salvarEdicao = (e: EscopoPendente, esc: AgendaEscopo) => {
    const b = base.current!;
    editar.mutate({
      escopo: esc,
      payload: montarPayloadEdicao(b.antes, e.depois, { escopo: esc }),
      participantes: esc === 'esta' ? null : e.participantes,
    });
  };

  const onSubmit = (valores: EventoFormValues) => {
    if (!ocorrencia) {
      criar.criar(valores);
      return;
    }
    const b = base.current!;
    const depois = montarPayload(valores);
    const acompanhou = regraAcompanhouData(b.opcao, b.regra, valores.data_inicio, depois.regra);
    const pessoasMudaram = !mesmasPessoas(b.participantes, valores.participantes);
    const pendente: EscopoPendente = {
      depois,
      participantes: pessoasMudaram ? valores.participantes : null,
      campos: camposDeSerieAlterados(b.antes, depois, {
        participantesMudaram: pessoasMudaram,
        regraAcompanhouData: acompanhou,
      }),
    };
    // The payload is not a pure diff (todas always carries the rule and series
    // fields), so "nothing changed" comes from the diff helper.
    if (chavesAlteradas(b.antes, depois).length === 0 && !pessoasMudaram) {
      fechar();
      return;
    }
    if (!ocorrencia.recorrente) {
      salvarEdicao(pendente, 'todas');
      return;
    }
    setEscopo(pendente);
  };

  // ---- Changes with side effects (not effects: a reset must not trigger them) ----

  const mudarDiaInteiro = (on: boolean) => {
    const atual = form.getValues();
    form.setValue('dia_inteiro', on, SUJO);
    form.setValue('lembretes', on ? [] : [10], SUJO);
    if (!on) {
      // Back to a timed event on the start day.
      form.setValue('data_fim', atual.data_inicio, SUJO);
      if (atual.hora_fim <= atual.hora_inicio) {
        const fim = new Date(
          combinarDataHora(atual.data_inicio, atual.hora_inicio).getTime() + 60 * 60_000,
        );
        form.setValue('data_fim', startOfDay(fim), SUJO);
        form.setValue('hora_fim', hhmm(fim), SUJO);
      }
    }
  };

  const pedirFechar = () => {
    if (isDirty && !salvando) setConfirmarCancelar(true);
    else if (!salvando) fechar();
  };

  const diaInteiro = !!v.dia_inteiro;
  const dataInicio = v.data_inicio ?? new Date();
  const lembretes = v.lembretes ?? [];
  const lembretesOferta = (diaInteiro ? LEMBRETES_DIA_INTEIRO : LEMBRETES_HORARIO).filter(
    (m) => !lembretes.includes(m),
  );
  const fusoDiferente = ocorrencia && ocorrencia.tz !== fusoDoNavegador() ? ocorrencia.tz : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !salvando && fechar()}>
      <DialogContent layout="fullscreen" confirmClose={isDirty || salvando} onConfirmClose={fechar}>
        <DialogTitle className="sr-only">
          {ocorrencia ? 'Editar evento' : 'Novo evento'}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {ocorrencia ? 'Edite os campos do evento.' : 'Preencha os campos do novo evento.'}
        </DialogDescription>
        <Form {...form}>
          {/* Mobile: the whole form scrolls and the top bar sticks. md+: only the body scrolls. */}
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex min-h-0 flex-1 flex-col overflow-y-auto md:overflow-hidden"
            noValidate
          >
            <div
              className="sticky top-0 z-10 flex shrink-0 items-start gap-2 border-b py-3 md:static"
              style={{
                background: 'var(--bg-color)',
                borderColor: 'var(--border-color)',
                paddingInline: GUTTER,
              }}
            >
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Fechar"
                onClick={pedirFechar}
                disabled={salvando}
                className="mb-0 mt-0.5 shrink-0"
              >
                <X className="h-5 w-5" />
              </Button>
              <FormField
                control={form.control}
                name="titulo"
                render={({ field }) => (
                  <FormItem className="min-w-0 flex-1 space-y-1">
                    <FormControl>
                      <Input
                        aria-label="Título"
                        placeholder="Adicionar título"
                        autoFocus
                        maxLength={200}
                        className="h-11 rounded-none border-0 border-b-2 bg-transparent px-1 text-[22px] font-medium shadow-none focus-visible:border-[var(--text-main)] focus-visible:ring-0 md:text-[22px]"
                        style={{ borderBottomColor: 'var(--border-color)' }}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" disabled={salvando} className="mb-0 mt-1 shrink-0">
                Salvar
              </Button>
            </div>

            <div className="shrink-0 pb-1 pt-4" style={{ paddingInline: GUTTER }}>
              <div className="mx-auto flex max-w-[1120px] flex-col gap-3">
                <Linha icone={Clock} alinhar="centro">
                  <QuandoCampos form={form} fusoDiferente={fusoDiferente} rotulo={false} />
                </Linha>
                <Linha icone={Repeat} alinhar="centro">
                  <div className="flex flex-wrap items-center gap-5">
                    <div className="flex items-center gap-2">
                      <Switch
                        id={`${ids}-dia-inteiro`}
                        checked={diaInteiro}
                        onCheckedChange={mudarDiaInteiro}
                      />
                      <Label htmlFor={`${ids}-dia-inteiro`}>Dia inteiro</Label>
                    </div>
                    <RepetirSelect
                      inicio={dataInicio}
                      repetir={v.repetir ?? 'nao'}
                      regra={v.regra ?? null}
                      onEscolher={(id, regra) => {
                        form.setValue('repetir', id, SUJO);
                        form.setValue('regra', regra, SUJO);
                      }}
                      onPersonalizar={() => setPersonalizar(true)}
                    />
                  </div>
                </Linha>
              </div>
            </div>

            <div className="min-h-0 shrink-0 md:shrink md:flex-1 md:overflow-y-auto">
              <div
                className="mx-auto grid max-w-[1120px] grid-cols-1 gap-6 py-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-8"
                style={{ paddingInline: GUTTER }}
              >
                <section
                  aria-labelledby={`${ids}-detalhes`}
                  className="flex flex-col gap-5 rounded-xl border p-5 md:p-6"
                  style={{ background: 'var(--card-bg)', borderColor: 'var(--border-color)' }}
                >
                  <h2 id={`${ids}-detalhes`} className="text-[15px] font-semibold">
                    Detalhes do evento
                  </h2>

                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="tipo"
                      render={({ field }) => (
                        <Linha icone={Tag}>
                          <FormItem>
                            <FormLabel>Tipo</FormLabel>
                            <Select value={field.value} onValueChange={field.onChange}>
                              <FormControl>
                                <SelectTrigger aria-label="Tipo">
                                  <SelectValue />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {TIPOS.map((t) => (
                                  <SelectItem key={t} value={t}>
                                    <span className="inline-flex items-center gap-2">
                                      <span
                                        className="inline-block h-[9px] w-[9px] rounded-full"
                                        style={{ background: TIPO_COR[t] }}
                                      />
                                      {TIPO_LABEL[t]}
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FormItem>
                        </Linha>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="cliente_id"
                      render={({ field }) => (
                        <Linha icone={Building2}>
                          <FormItem>
                            <FormLabel>Cliente</FormLabel>
                            <Select value={field.value} onValueChange={field.onChange}>
                              <FormControl>
                                <SelectTrigger aria-label="Cliente">
                                  <SelectValue />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="none">Sem cliente</SelectItem>
                                {clientesVisiveis.map((c) => (
                                  <SelectItem key={c.id} value={String(c.id)}>
                                    {c.nome}
                                  </SelectItem>
                                ))}
                                {/* The stored client may not be loaded yet: keep the value selectable. */}
                                {clienteAtual !== null &&
                                  !clientesVisiveis.some((c) => c.id === clienteAtual) && (
                                    <SelectItem value={String(clienteAtual)}>
                                      {ocorrencia?.cliente_nome ?? 'Cliente'}
                                    </SelectItem>
                                  )}
                              </SelectContent>
                            </Select>
                          </FormItem>
                        </Linha>
                      )}
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="local"
                      render={({ field }) => (
                        <Linha icone={MapPin}>
                          <FormItem>
                            <FormLabel>Local</FormLabel>
                            <FormControl>
                              <LocalAutocomplete maxLength={300} {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        </Linha>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="link_reuniao"
                      render={({ field }) => (
                        <Linha icone={Video}>
                          <FormItem>
                            <FormLabel>Link da reunião</FormLabel>
                            <FormControl>
                              <Input
                                type="url"
                                inputMode="url"
                                placeholder="https://"
                                maxLength={500}
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        </Linha>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="lembretes"
                    render={({ field }) => (
                      <Linha icone={Bell}>
                        <FormItem>
                          <FormLabel>Lembretes</FormLabel>
                          <div className="flex flex-wrap items-center gap-2">
                            {[...field.value]
                              .sort((a, b) => a - b)
                              .map((m) => {
                                const rotulo = rotuloLembrete(m, diaInteiro);
                                return (
                                  <span
                                    key={m}
                                    className="inline-flex h-[30px] items-center gap-1.5 rounded-full px-2.5 text-[13px]"
                                    style={{ background: 'var(--surface-2)' }}
                                  >
                                    {rotulo}
                                    <button
                                      type="button"
                                      aria-label={`Remover lembrete ${rotulo}`}
                                      onClick={() =>
                                        field.onChange(field.value.filter((x) => x !== m))
                                      }
                                      style={{ color: 'var(--text-muted)' }}
                                    >
                                      <X className="h-3.5 w-3.5" />
                                    </button>
                                  </span>
                                );
                              })}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="mb-0"
                                  disabled={
                                    field.value.length >= MAX_LEMBRETES ||
                                    lembretesOferta.length === 0
                                  }
                                >
                                  <Plus className="mr-1 h-3.5 w-3.5" />
                                  Adicionar lembrete
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="start" className={MENU_SOBRE_DIALOG_Z}>
                                {lembretesOferta.map((m) => (
                                  <DropdownMenuItem
                                    key={m}
                                    onSelect={() => field.onChange([...field.value, m])}
                                  >
                                    {rotuloLembrete(m, diaInteiro)}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                          <FormMessage />
                        </FormItem>
                      </Linha>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="privado"
                    render={({ field }) => (
                      <Linha icone={Lock} alinhar="centro">
                        <div
                          className="flex items-center justify-between gap-3 rounded-[10px] px-3.5 py-3"
                          style={{ background: 'var(--surface-1)' }}
                        >
                          <div>
                            <Label htmlFor={`${ids}-privado`} className="text-sm font-semibold">
                              Evento privado
                            </Label>
                            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                              Outras pessoas verão apenas &quot;Ocupado&quot; nesse horário.
                            </p>
                          </div>
                          <Switch
                            id={`${ids}-privado`}
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </div>
                      </Linha>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="descricao"
                    render={({ field }) => (
                      <Linha icone={AlignLeft}>
                        <FormItem>
                          <FormLabel>Descrição</FormLabel>
                          <FormControl>
                            <Textarea
                              rows={8}
                              maxLength={5000}
                              className="resize-none"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      </Linha>
                    )}
                  />
                </section>

                <section
                  className="flex flex-col gap-3 rounded-xl border p-5 md:p-6"
                  style={{ background: 'var(--card-bg)', borderColor: 'var(--border-color)' }}
                >
                  <FormField
                    control={form.control}
                    name="participantes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-[15px] font-semibold">Participantes</FormLabel>
                        <PessoasCombobox
                          pessoas={pessoas}
                          value={field.value}
                          onChange={field.onChange}
                          max={MAX_PARTICIPANTES}
                        />
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          Quem for adicionado recebe a notificação no app e por e-mail.
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </section>
              </div>
            </div>
          </form>
        </Form>

        {/* Nested dialogs live inside the content on purpose: Radix treats focus and
              pointer events inside a React-tree child as "inside", so opening them does
              not trip this dialog's outside-interaction close guard. */}
        <RecorrenciaPersonalizadaDialog
          open={personalizar}
          inicio={dataInicio}
          regra={v.regra ?? null}
          onCancel={() => setPersonalizar(false)}
          onConcluir={(regra) => {
            form.setValue('regra', regra, SUJO);
            form.setValue('repetir', opcaoDaRegra(regra, dataInicio), SUJO);
            setPersonalizar(false);
          }}
        />

        <EscopoEventoDialog
          open={escopo !== null}
          acao="editar"
          esteDesabilitado={(escopo?.campos.length ?? 0) > 0}
          motivo={escopo ? motivoSerie(escopo.campos) : null}
          pendente={editar.isPending}
          onCancel={() => setEscopo(null)}
          onConfirm={(esc) => escopo && salvarEdicao(escopo, esc)}
        />

        <AlertDialog open={confirmarCancelar} onOpenChange={setConfirmarCancelar}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{CONFIRM_CLOSE_TITLE}</AlertDialogTitle>
              <AlertDialogDescription>{CONFIRM_CLOSE_MSG}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{CONFIRM_CLOSE_KEEP_EDITING}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setConfirmarCancelar(false);
                  fechar();
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {CONFIRM_CLOSE_DISCARD}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
