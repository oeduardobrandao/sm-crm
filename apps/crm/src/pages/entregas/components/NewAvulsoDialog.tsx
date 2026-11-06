import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CONTENT_FORMATS } from '@mesaas/platforms';
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
import {
  applyPostProcess,
  createAvulsoPost,
  type Cliente,
  type WorkflowPost,
  type WorkflowTemplate,
} from '@/store';
import { TIPO_LABELS, TIPO_ORDER } from '../postLabels';
import { buildTemplateFingerprint } from '../fingerprint';
import { buildApplyPlan } from '../applyProcessDeadlines';
import { getPostProcessErrorToast } from '../postProcessErrors';

// Built per render language so the validation messages follow the UI language.
const makeAvulsoSchema = (t: TFunction<'workflows'>) =>
  z.object({
    cliente_id: z.string().min(1, t('newAvulso.selectClient')),
    titulo: z.string().trim().min(1, t('newAvulso.titleRequired')),
    tipo: z.enum(CONTENT_FORMATS),
  });

type AvulsoFormValues = z.infer<ReturnType<typeof makeAvulsoSchema>>;

const BLANK: AvulsoFormValues = { cliente_id: '', titulo: '', tipo: 'feed' };

interface NewAvulsoDialogProps {
  open: boolean;
  onClose: () => void;
  clientes: Cliente[];
  /** Fires after the post is created (and its cache invalidated), so the
   *  caller can switch into the right view/mode and open it. Also the landing
   *  for a FAILED auto-apply (spec §3: toast de erro + abrir o drawer do post
   *  avulso normalmente, no estado "sem processo"). */
  onCreated: (post: WorkflowPost) => void;
  /** Auto-apply bem-sucedido (spec §3): o post nasce COM processo, então o
   *  destino não é o drawer de avulso de `onCreated` e sim a revelação do
   *  processo no quadro de Fluxos, como nos demais `onApplied`. Sem handler,
   *  cai em `onCreated`. */
  onProcessApplied?: (post: WorkflowPost) => void;
  /** Template pré-vinculado (spec §3, "+ Novo ▾" da coluna): quando setado,
   *  o submit tenta aplicar o processo automaticamente. Requer `templates`
   *  para resolver o objeto do template. */
  templateId?: number;
  templates?: WorkflowTemplate[];
  /** Template com modo_prazo != 'padrao' precisa de input extra (etapa
   *  inicial, responsáveis, prazos) que este diálogo não coleta -- em vez de
   *  aplicar sozinho, repassa post+template para o caller abrir o fluxo
   *  manual (ApplyProcessDialog). Chamado NO LUGAR de `onCreated`. */
  onNeedsManualApply?: (post: WorkflowPost, template: WorkflowTemplate) => void;
}

/** Creates a post avulso (fora de um fluxo) -- the "Post avulso" item in the
 *  Novo dropdown. Mirrors TarefaFormDialog's form shape (react-hook-form +
 *  zod), but this dialog only ever creates (no edit mode). */
export function NewAvulsoDialog({
  open,
  onClose,
  clientes,
  onCreated,
  onProcessApplied,
  templateId,
  templates,
  onNeedsManualApply,
}: NewAvulsoDialogProps) {
  const { t } = useTranslation('workflows');
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const avulsoSchema = useMemo(() => makeAvulsoSchema(t), [t]);

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
      toast.success(t('newAvulso.created'));
      qc.invalidateQueries({ queryKey: ['active-posts'] });

      const template =
        templateId != null ? (templates ?? []).find((tpl) => tpl.id === templateId) : undefined;
      if (template) {
        // buildApplyPlan/applyPostProcess treat a missing modo_prazo the same
        // as 'padrao' (see applyProcessDeadlines.ts) -- match that here so a
        // legacy template without the column doesn't fall into the manual
        // dialog for no reason.
        const modo = template.modo_prazo ?? 'padrao';
        if (modo === 'padrao') {
          let applied = false;
          try {
            const plan = buildApplyPlan({
              template,
              startOrdem: 0,
              now: new Date(),
              fixedDates: {},
              deliveryDate: null,
              clienteHasDiaEntrega: false,
              responsaveis: {},
            });
            await applyPostProcess({
              postId: post.id!,
              templateId: template.id!,
              templateFingerprint: buildTemplateFingerprint(template.etapas),
              startOrdem: 0,
              stepOverrides: plan.overrides,
            });
            applied = true;
            for (const key of [
              ['post-processes'],
              ['post-process', post.id],
              ['post-process-events'],
              ['active-posts'],
              ['standalone-post', post.id],
            ])
              qc.invalidateQueries({ queryKey: key });
          } catch (err) {
            toast.error(getPostProcessErrorToast(err, t('newAvulso.applyError')));
          }
          // Sucesso: o post já tem processo, então quem revela é o quadro de
          // Fluxos. Falha: cai no drawer de avulso (spec §3, estado recuperável
          // via "Aplicar processo").
          if (applied && onProcessApplied) onProcessApplied(post);
          else onCreated(post);
        } else if (onNeedsManualApply) {
          onNeedsManualApply(post, template);
        } else {
          // Sem handler manual não há para onde encaminhar: não deixar o post
          // criado sem nenhum destino.
          onCreated(post);
        }
      } else {
        onCreated(post);
      }
      onClose();
    } catch {
      toast.error(t('newAvulso.createError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{t('newAvulso.title')}</DialogTitle>
          <DialogDescription className="sr-only">{t('newAvulso.srDesc')}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <FormField
              control={form.control}
              name="cliente_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('newAvulso.client')}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t('newAvulso.selectClient')} />
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
                  <FormLabel>{t('newAvulso.postTitle')}</FormLabel>
                  <FormControl>
                    <Input placeholder={t('newAvulso.postTitlePlaceholder')} autoFocus {...field} />
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
                  <FormLabel>{t('newAvulso.type')}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {TIPO_ORDER.map((tipo) => (
                        <SelectItem key={tipo} value={tipo}>
                          {TIPO_LABELS[tipo]}
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
                {t('actions.cancel')}
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? t('newAvulso.creating') : t('newAvulso.create')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
