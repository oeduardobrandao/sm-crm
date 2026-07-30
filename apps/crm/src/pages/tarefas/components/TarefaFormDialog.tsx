import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
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
import { Textarea } from '@/components/ui/textarea';
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
  updateTarefa,
  setTarefaTags,
  type Cliente,
  type Membro,
  type TarefaTag,
  type TarefaWithRelations,
} from '../../../store';
import { parseDateOnly, toDateOnlyString, STATUS_LABELS, STATUS_ORDER } from '../tarefasLogic';
import { TagPicker } from './TagPicker';

const tarefaSchema = z.object({
  titulo: z.string().trim().min(1, 'Informe o título da tarefa'),
  descricao: z.string(),
  responsavel_id: z.string(),
  cliente_id: z.string(),
  data_limite: z.date().optional(),
  status: z.enum(['pendente', 'em_andamento', 'concluida']),
});

type TarefaFormValues = z.infer<typeof tarefaSchema>;

const BLANK: TarefaFormValues = {
  titulo: '',
  descricao: '',
  responsavel_id: 'none',
  cliente_id: 'none',
  data_limite: undefined,
  status: 'pendente',
};

export type TarefaFormPayload = {
  titulo: string;
  descricao: string | null;
  status: 'pendente' | 'em_andamento' | 'concluida';
  responsavel_id: number | null;
  cliente_id: number | null;
  data_limite: string | null;
};

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
  /** Create-mode prefill (conversao de solicitacao). */
  initialValues?: { titulo?: string; descricao?: string; cliente_id?: number | null };
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
  const [tagIds, setTagIds] = useState<number[]>([]);

  const form = useForm<TarefaFormValues>({
    resolver: zodResolver(tarefaSchema),
    defaultValues: BLANK,
  });

  // Destructure to primitives: initialValues is naturally passed as an inline object
  // literal by callers (conversao de solicitacao), so a new reference on every parent
  // re-render must NOT retrigger the reset below and clobber in-progress edits.
  const initialTitulo = initialValues?.titulo;
  const initialDescricao = initialValues?.descricao;
  const initialClienteId = initialValues?.cliente_id;

  useEffect(() => {
    if (!open) return;
    if (editing) {
      form.reset({
        titulo: editing.titulo,
        descricao: editing.descricao ?? '',
        responsavel_id: editing.responsavel_id != null ? String(editing.responsavel_id) : 'none',
        cliente_id: editing.cliente_id != null ? String(editing.cliente_id) : 'none',
        data_limite: editing.data_limite ? parseDateOnly(editing.data_limite) : undefined,
        status: editing.status,
      });
      setTagIds(editing.tags.map((t) => t.id!).filter((id) => id != null));
    } else {
      form.reset({
        ...BLANK,
        titulo: initialTitulo ?? '',
        descricao: initialDescricao ?? '',
        cliente_id: initialClienteId != null ? String(initialClienteId) : 'none',
      });
      setTagIds([]);
    }
  }, [open, editing, initialTitulo, initialDescricao, initialClienteId, form]);

  const activeClientes = clientes
    .filter(
      (c) =>
        c.status === 'ativo' || c.id === editing?.cliente_id || c.id === initialValues?.cliente_id,
    )
    .sort((a, b) => a.nome.localeCompare(b.nome));
  const sortedMembros = [...membros].sort((a, b) => a.nome.localeCompare(b.nome));

  const onSubmit = async (values: TarefaFormValues) => {
    setSaving(true);
    const payload = {
      titulo: values.titulo.trim(),
      descricao: values.descricao.trim() || null,
      status: values.status,
      responsavel_id: values.responsavel_id === 'none' ? null : parseInt(values.responsavel_id, 10),
      cliente_id: values.cliente_id === 'none' ? null : parseInt(values.cliente_id, 10),
      data_limite: values.data_limite ? toDateOnlyString(values.data_limite) : null,
    };
    try {
      if (editing) {
        await updateTarefa(editing.id!, payload);
        await setTarefaTags(editing.id!, tagIds);
        toast.success('Tarefa atualizada!');
      } else if (onCreate) {
        await onCreate(payload, tagIds);
      } else {
        await addTarefa(payload, tagIds);
        toast.success('Tarefa criada!');
      }
      onSaved();
      onClose();
    } catch (e) {
      const fallback = editing ? 'Erro ao atualizar tarefa' : 'Erro ao criar tarefa';
      const message = onCreate && e instanceof Error && e.message ? e.message : fallback;
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
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
                  <FormControl>
                    <Textarea rows={3} placeholder="Detalhes, contexto, links..." {...field} />
                  </FormControl>
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
                      <FormLabel>Status</FormLabel>
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
              <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Salvando...' : editing ? 'Salvar' : 'Criar tarefa'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
