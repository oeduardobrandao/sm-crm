import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { captureEvent } from '@/lib/analytics';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DatePicker } from '@/components/ui/date-picker';
import {
  addTarefa,
  aplicarEdicaoSerie,
  criarTarefaSerie,
  isSerieDateConflict,
  updateTarefa,
  setTarefaTags,
  type Cliente,
  type Membro,
  type TarefaSerieRegra,
  type TarefaTag,
  type TarefaWithRelations,
} from '../../../store';
import { parseDateOnly, toDateOnlyString, STATUS_LABELS, STATUS_ORDER } from '../tarefasLogic';
import { tarefaFormSchema, BLANK_TAREFA_FORM, type TarefaFormValues } from './tarefaFormSchema';
import { RecorrenciaFields } from './RecorrenciaFields';
import { regraFromForm, regraIgual } from '../recorrenciaLogic';
import { EscopoEdicaoDialog } from './EscopoEdicaoDialog';
import { TagPicker } from './TagPicker';
import { TarefaDescriptionEditor } from './TarefaDescriptionEditor';
import {
  isTarefaDescriptionEmpty,
  plainTextToTarefaDescriptionDoc,
  sanitizeTarefaDescriptionDoc,
  type TarefaDescriptionDoc,
} from '../tarefaDescription';

export type TarefaFormPayload = {
  titulo: string;
  descricao: string | null;
  descricao_rich: TarefaDescriptionDoc | null;
  status: 'pendente' | 'em_andamento' | 'concluida';
  responsavel_id: number | null;
  cliente_id: number | null;
  data_limite: string | null;
};

/** RPC failures carry a pt-BR RAISE message worth showing; PostgREST table
 *  errors do not. Errors from criarTarefaSerie/aplicarEdicaoSerie are
 *  PostgrestError objects whose message is the RAISE text. */
function mensagemErro(e: unknown, fallback: string, fromOnCreate: boolean): string {
  if (isSerieDateConflict(e)) return 'Já existe uma ocorrência desta série nesse dia.';
  const msg =
    e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : '';
  const conhecida =
    msg.startsWith('Para repetir') ||
    msg.startsWith('Tarefas de uma série') ||
    msg.startsWith('A data final') ||
    msg.startsWith('Reabra a tarefa') ||
    msg.startsWith('Esta tarefa já pertence') ||
    msg.startsWith('Responsável não encontrado') ||
    msg.startsWith('Cliente não encontrado');
  if (conhecida || (fromOnCreate && msg)) return msg;
  return fallback;
}

interface TarefaFormDialogProps {
  open: boolean;
  onClose: () => void;
  /** Null = create mode; a task = edit mode. */
  editing: TarefaWithRelations | null;
  membros: Membro[];
  clientes: Cliente[];
  tags: TarefaTag[];
  onSaved: () => void;
  onTagCreated: () => void;
  /** Create-mode prefill (conversao de solicitacao; also used by the Board
   *  view's per-column "+ Adicionar tarefa"). */
  initialValues?: {
    titulo?: string;
    descricao?: string;
    cliente_id?: number | null;
    data_limite?: string | null;
  };
  /** Trava o campo cliente (a RPC de conversao fixa o cliente de qualquer forma). */
  lockCliente?: boolean;
  /** Substitui o addTarefa interno no submit de criacao. Quem fornece e dono dos toasts de sucesso. */
  onCreate?: (payload: TarefaFormPayload, tagIds: number[]) => Promise<void>;
}

export function TarefaFormDialog({
  open,
  onClose,
  editing,
  membros,
  clientes,
  tags,
  onSaved,
  onTagCreated,
  initialValues,
  lockCliente,
  onCreate,
}: TarefaFormDialogProps) {
  const [saving, setSaving] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [tagIds, setTagIds] = useState<number[]>([]);
  const [descriptionDoc, setDescriptionDoc] = useState<TarefaDescriptionDoc>(() =>
    plainTextToTarefaDescriptionDoc(''),
  );
  const [editorInitialContent, setEditorInitialContent] = useState<TarefaDescriptionDoc>(() =>
    plainTextToTarefaDescriptionDoc(''),
  );
  const [editorRevision, setEditorRevision] = useState(0);
  // Pending occurrence edit awaiting the scope choice (spec: Scope dialogs > Edit).
  const [escopo, setEscopo] = useState<{
    payload: TarefaFormPayload;
    regra: TarefaSerieRegra;
    regraAlterada: boolean;
  } | null>(null);

  const form = useForm<TarefaFormValues>({
    resolver: zodResolver(tarefaFormSchema),
    defaultValues: BLANK_TAREFA_FORM,
  });

  // Destructure to primitives: initialValues is naturally passed as an inline object
  // literal by callers (conversao de solicitacao), so a new reference on every parent
  // re-render must NOT retrigger the reset below and clobber in-progress edits.
  const initialTitulo = initialValues?.titulo;
  const initialDescricao = initialValues?.descricao;
  const initialClienteId = initialValues?.cliente_id;
  const initialDataLimite = initialValues?.data_limite;

  useEffect(() => {
    if (!open) return;
    if (editing) {
      const richDescription =
        editing.descricao_rich ?? plainTextToTarefaDescriptionDoc(editing.descricao ?? '');
      const serie = editing.serie;
      form.reset({
        titulo: editing.titulo,
        descricao: editing.descricao ?? '',
        responsavel_id: editing.responsavel_id != null ? String(editing.responsavel_id) : 'none',
        cliente_id: editing.cliente_id != null ? String(editing.cliente_id) : 'none',
        data_limite: editing.data_limite ? parseDateOnly(editing.data_limite) : undefined,
        status: editing.status,
        repetir: serie ? serie.freq : 'never',
        intervalo: serie ? String(serie.intervalo) : '1',
        dias_semana: serie?.dias_semana ?? [],
        fim: serie?.fim ? parseDateOnly(serie.fim) : undefined,
        modo: serie?.modo ?? 'ao_concluir',
        serie_nova: !serie,
      });
      setDescriptionDoc(richDescription);
      setEditorInitialContent(richDescription);
      setEditorRevision((value) => value + 1);
      setImageUploading(false);
      setTagIds(editing.tags.map((t) => t.id!).filter((id) => id != null));
    } else {
      const richDescription = plainTextToTarefaDescriptionDoc(initialDescricao ?? '');
      form.reset({
        ...BLANK_TAREFA_FORM,
        titulo: initialTitulo ?? '',
        descricao: initialDescricao ?? '',
        cliente_id: initialClienteId != null ? String(initialClienteId) : 'none',
        data_limite: initialDataLimite ? parseDateOnly(initialDataLimite) : undefined,
      });
      setDescriptionDoc(richDescription);
      setEditorInitialContent(richDescription);
      setEditorRevision((value) => value + 1);
      setImageUploading(false);
      setTagIds([]);
    }
  }, [open, editing, initialTitulo, initialDescricao, initialClienteId, initialDataLimite, form]);

  const activeClientes = clientes
    .filter(
      (c) =>
        c.status === 'ativo' || c.id === editing?.cliente_id || c.id === initialValues?.cliente_id,
    )
    .sort((a, b) => a.nome.localeCompare(b.nome));
  const sortedMembros = [...membros].sort((a, b) => a.nome.localeCompare(b.nome));

  const isOcorrencia = !!editing?.serie;
  const repetirBloqueado = !!editing && !editing.serie && editing.status === 'concluida';
  const landing = editing?.serie
    ? { dia_mes: editing.serie.dia_mes, mes: editing.serie.mes }
    : null;

  const onSubmit = async (values: TarefaFormValues) => {
    if (imageUploading) return;
    setSaving(true);
    const sanitizedDescription = sanitizeTarefaDescriptionDoc(descriptionDoc);
    const payload: TarefaFormPayload = {
      titulo: values.titulo.trim(),
      descricao: values.descricao.trim() || null,
      descricao_rich: isTarefaDescriptionEmpty(sanitizedDescription) ? null : sanitizedDescription,
      status: values.status,
      responsavel_id: values.responsavel_id === 'none' ? null : parseInt(values.responsavel_id, 10),
      cliente_id: values.cliente_id === 'none' ? null : parseInt(values.cliente_id, 10),
      data_limite: values.data_limite ? toDateOnlyString(values.data_limite) : null,
    };
    // Conversion mode has no recurrence inputs (the section is hidden there).
    const regra =
      !onCreate && values.data_limite ? regraFromForm(values, values.data_limite, landing) : null;
    try {
      if (editing && isOcorrencia) {
        const serieAtual = editing.serie!;
        const regraAtual: TarefaSerieRegra = {
          freq: serieAtual.freq,
          intervalo: serieAtual.intervalo,
          dias_semana: serieAtual.dias_semana,
          dia_mes: serieAtual.dia_mes,
          mes: serieAtual.mes,
          modo: serieAtual.modo,
          fim: serieAtual.fim,
        };
        if (values.repetir === 'never' || !regra) {
          // "Não repete": "Esta e as próximas" by construction, so no dialog
          await aplicarEdicaoSerie(editing.id!, payload, tagIds, regraAtual, true);
          toast.success('Tarefa atualizada!');
        } else {
          setEscopo({ payload, regra, regraAlterada: !regraIgual(regra, regraAtual) });
          return; // the dialog's handlers finish the save; `finally` clears saving
        }
      } else if (editing && regra) {
        // standalone task promoted to a series: no scope dialog
        await criarTarefaSerie(regra, payload, tagIds, [], editing.id!);
        toast.success('Tarefa atualizada!');
      } else if (editing) {
        await updateTarefa(editing.id!, payload);
        await setTarefaTags(editing.id!, tagIds);
        toast.success('Tarefa atualizada!');
      } else if (onCreate) {
        await onCreate(payload, tagIds);
      } else if (regra) {
        await criarTarefaSerie(regra, payload, tagIds, []);
        captureEvent('task_created', { status: values.status, recorrente: true });
        toast.success('Tarefa criada!');
      } else {
        await addTarefa(payload, tagIds);
        captureEvent('task_created', { status: values.status });
        toast.success('Tarefa criada!');
      }
      onSaved();
      onClose();
    } catch (e) {
      toast.error(
        mensagemErro(e, editing ? 'Erro ao atualizar tarefa' : 'Erro ao criar tarefa', !!onCreate),
      );
    } finally {
      setSaving(false);
    }
  };

  const finalizarEscopo = async (run: () => Promise<void>) => {
    if (!editing) return;
    setSaving(true);
    try {
      await run();
      toast.success('Tarefa atualizada!');
      setEscopo(null);
      onSaved();
      onClose();
    } catch (e) {
      toast.error(mensagemErro(e, 'Erro ao atualizar tarefa', false));
    } finally {
      setSaving(false);
    }
  };

  const salvarSomenteEsta = () =>
    finalizarEscopo(async () => {
      await updateTarefa(editing!.id!, escopo!.payload);
      await setTarefaTags(editing!.id!, tagIds);
    });

  const salvarEstaEProximas = () =>
    finalizarEscopo(() =>
      aplicarEdicaoSerie(editing!.id!, escopo!.payload, tagIds, escopo!.regra, false),
    );

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && !saving && !imageUploading && onClose()}>
        <DialogContent className="sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>
              {editing ? 'Editar tarefa' : onCreate ? 'Converter em tarefa' : 'Nova tarefa'}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {editing
                ? 'Edite os campos da tarefa'
                : onCreate
                  ? 'Preencha os campos para converter a solicitação em tarefa'
                  : 'Preencha os campos da nova tarefa'}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
              <FormField
                control={form.control}
                name="titulo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Título</FormLabel>
                    <FormControl>
                      <Input placeholder="O que precisa ser feito?" autoFocus {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="descricao"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descrição</FormLabel>
                    <TarefaDescriptionEditor
                      key={editorRevision}
                      initialContent={editorInitialContent}
                      onUpdate={(doc, plainText) => {
                        setDescriptionDoc(sanitizeTarefaDescriptionDoc(doc));
                        field.onChange(plainText);
                      }}
                      onUploadStateChange={setImageUploading}
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="responsavel_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Responsável</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">Sem responsável</SelectItem>
                          {sortedMembros
                            .filter((m) => m.id != null)
                            .map((m) => (
                              <SelectItem key={m.id} value={String(m.id)}>
                                {m.nome}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="cliente_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cliente</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={lockCliente}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">Sem cliente</SelectItem>
                          {activeClientes
                            .filter((c) => c.id != null)
                            .map((c) => (
                              <SelectItem key={c.id} value={String(c.id)}>
                                {c.nome}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="data_limite"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>Prazo</FormLabel>
                      <FormControl>
                        <DatePicker
                          value={field.value}
                          onChange={field.onChange}
                          placeholder="Sem prazo"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {editing && (
                  <FormField
                    control={form.control}
                    name="status"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="block">Status</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {STATUS_ORDER.map((s) => (
                              <SelectItem key={s} value={s}>
                                {STATUS_LABELS[s]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>
              {!onCreate && (
                <RecorrenciaFields
                  form={form}
                  landing={landing}
                  disabled={repetirBloqueado}
                  disabledHint={
                    repetirBloqueado ? 'Reabra a tarefa para torná-la recorrente.' : undefined
                  }
                />
              )}
              <div>
                <FormLabel className="mb-2 block">Tags</FormLabel>
                <TagPicker
                  tags={tags}
                  selectedIds={tagIds}
                  onSelectedChange={setTagIds}
                  onTagCreated={onTagCreated}
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={onClose}
                  disabled={saving || imageUploading}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={saving || imageUploading}>
                  {imageUploading
                    ? 'Enviando imagem...'
                    : saving
                      ? 'Salvando...'
                      : editing
                        ? 'Salvar'
                        : 'Criar tarefa'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
      <EscopoEdicaoDialog
        open={escopo !== null}
        regraAlterada={escopo?.regraAlterada ?? false}
        saving={saving}
        onSomenteEsta={salvarSomenteEsta}
        onEstaEProximas={salvarEstaEProximas}
        onCancel={() => setEscopo(null)}
      />
    </>
  );
}
