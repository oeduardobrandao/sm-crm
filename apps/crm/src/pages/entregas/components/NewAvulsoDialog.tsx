import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
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
import { createAvulsoPost, type Cliente, type WorkflowPost } from '@/store';
import { TIPO_LABELS, TIPO_ORDER } from '../postLabels';

const avulsoSchema = z.object({
  cliente_id: z.string().min(1, 'Selecione um cliente'),
  titulo: z.string().trim().min(1, 'Informe o título do post'),
  tipo: z.enum(['feed', 'reels', 'stories', 'carrossel']),
});

type AvulsoFormValues = z.infer<typeof avulsoSchema>;

const BLANK: AvulsoFormValues = { cliente_id: '', titulo: '', tipo: 'feed' };

interface NewAvulsoDialogProps {
  open: boolean;
  onClose: () => void;
  clientes: Cliente[];
  /** Fires after the post is created (and its cache invalidated), so the
   *  caller can switch into the right view/mode and open it. */
  onCreated: (post: WorkflowPost) => void;
}

/** Creates a post avulso (fora de um fluxo) -- the "Post avulso" item in the
 *  Novo dropdown. Mirrors TarefaFormDialog's form shape (react-hook-form +
 *  zod), but this dialog only ever creates (no edit mode). */
export function NewAvulsoDialog({ open, onClose, clientes, onCreated }: NewAvulsoDialogProps) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);

  const form = useForm<AvulsoFormValues>({
    resolver: zodResolver(avulsoSchema),
    defaultValues: BLANK,
  });

  useEffect(() => {
    if (open) form.reset(BLANK);
  }, [open, form]);

  const activeClientes = [...clientes]
    .filter((c) => c.status === 'ativo' && c.id != null)
    .sort((a, b) => a.nome.localeCompare(b.nome));

  const onSubmit = async (values: AvulsoFormValues) => {
    setSaving(true);
    try {
      const post = await createAvulsoPost({
        cliente_id: parseInt(values.cliente_id, 10),
        titulo: values.titulo.trim(),
        tipo: values.tipo,
      });
      toast.success('Post avulso criado');
      qc.invalidateQueries({ queryKey: ['active-posts'] });
      onCreated(post);
      onClose();
    } catch {
      toast.error('Erro ao criar post avulso');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Post avulso</DialogTitle>
          <DialogDescription className="sr-only">Crie um post fora de um fluxo</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <FormField
              control={form.control}
              name="cliente_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cliente</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione um cliente" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {activeClientes.map((c) => (
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
            <FormField
              control={form.control}
              name="titulo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Título</FormLabel>
                  <FormControl>
                    <Input placeholder="Título do post" autoFocus {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="tipo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tipo</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {TIPO_ORDER.map((t) => (
                        <SelectItem key={t} value={t}>
                          {TIPO_LABELS[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Criando...' : 'Criar post'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
