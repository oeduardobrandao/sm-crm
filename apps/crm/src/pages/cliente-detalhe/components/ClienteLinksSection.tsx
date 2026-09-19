import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import {
  getClienteLinks,
  addClienteLink,
  updateClienteLink,
  removeClienteLink,
  type ClienteLink,
} from '@/store';
import { sanitizeUrl } from '@/utils/security';
import { normalizeLinkUrl, linkDomain } from '../linkUrl';

interface ClienteLinksSectionProps {
  clienteId: number;
}

const EMPTY_FORM = { titulo: '', url: '', descricao: '' };

function buildLinkSchema(t: TFunction) {
  return z.object({
    titulo: z
      .string()
      .trim()
      .min(1, t('detail.linkTitleRequired'))
      .max(120, t('detail.linkTitleTooLong')),
    url: z
      .string()
      .trim()
      .refine((v) => normalizeLinkUrl(v) !== null, t('detail.linkUrlInvalid')),
    descricao: z.string().trim().max(300),
  });
}

type LinkFormValues = z.infer<ReturnType<typeof buildLinkSchema>>;

/**
 * "Links úteis" card for the client's "Visão geral" tab: Drive, Notion, Figma
 * and similar links, each with a title, URL and optional description. Owns its
 * own `['clienteLinks', clienteId]` query, like the Datas and Endereços
 * sections next to it. `confirmClose` (typed-but-unsaved input or a save in
 * flight) is what arms the Dialog's unsaved-work guard: without it neither the
 * silent-update hold nor the Escape/outside-click prompt is active.
 */
export function ClienteLinksSection({ clienteId }: ClienteLinksSectionProps) {
  const { t } = useTranslation('clients');
  const { t: tc } = useTranslation();
  const queryClient = useQueryClient();

  const { data: links, isLoading } = useQuery({
    queryKey: ['clienteLinks', clienteId],
    queryFn: () => getClienteLinks(clienteId),
    enabled: !isNaN(clienteId),
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ClienteLink | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const form = useForm<LinkFormValues>({
    resolver: zodResolver(buildLinkSchema(t)),
    defaultValues: EMPTY_FORM,
  });
  const { errors, isDirty, isSubmitting } = form.formState;

  const closeDialog = () => {
    setDialogOpen(false);
    setEditing(null);
    form.reset(EMPTY_FORM);
  };

  const openDialog = (l?: ClienteLink) => {
    setEditing(l ?? null);
    form.reset(l ? { titulo: l.titulo, url: l.url, descricao: l.descricao ?? '' } : EMPTY_FORM);
    setDialogOpen(true);
  };

  const onSubmit = async (values: LinkFormValues) => {
    const payload = {
      titulo: values.titulo,
      url: normalizeLinkUrl(values.url) as string,
      descricao: values.descricao || null,
    };
    try {
      if (editing?.id) {
        await updateClienteLink(editing.id, payload);
        toast.success(t('detail.linkUpdated'));
      } else {
        await addClienteLink({ cliente_id: clienteId, ...payload });
        toast.success(t('detail.linkAdded'));
      }
      queryClient.invalidateQueries({ queryKey: ['clienteLinks', clienteId] });
      closeDialog();
    } catch (err: unknown) {
      toast.error(t('detail.genericError', { error: (err as Error).message }));
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await removeClienteLink(deleteId);
      queryClient.invalidateQueries({ queryKey: ['clienteLinks', clienteId] });
      toast.success(t('detail.linkRemoved'));
    } catch (err: unknown) {
      toast.error(t('detail.genericError', { error: (err as Error).message }));
    }
    setDeleteId(null);
  };

  return (
    <>
      <div id="sec-links" className="card animate-up" style={{ marginBottom: '1.5rem' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1rem',
          }}
        >
          <h3 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2 mb-0">
            <Link2 className="h-5 w-5" style={{ color: 'var(--primary-color)' }} />
            {t('detail.usefulLinks')}
          </h3>
          <Button size="sm" onClick={() => openDialog()}>
            <Plus className="h-4 w-4" style={{ marginRight: 4 }} /> {t('detail.addLink')}
          </Button>
        </div>

        {isLoading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '1.5rem' }}>
            <Spinner size="sm" />
          </div>
        )}

        {!isLoading && (!links || links.length === 0) && (
          <div
            style={{
              textAlign: 'center',
              padding: '2rem 1rem',
              color: 'var(--text-muted)',
              border: '1px dashed var(--border-color)',
              borderRadius: '12px',
            }}
          >
            <Link2 className="h-8 w-8" style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
            <p style={{ fontSize: '0.9rem' }}>{t('detail.noUsefulLinks')}</p>
            <p style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>{t('detail.addLinkHint')}</p>
          </div>
        )}

        {!isLoading && links && links.length > 0 && (
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {links.map((l) => (
              <div key={l.id} className="cliente-date-card">
                <a
                  href={sanitizeUrl(l.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ flex: 1, minWidth: 0, color: 'inherit', textDecoration: 'none' }}
                >
                  <p
                    style={{
                      fontSize: '0.9rem',
                      fontWeight: 600,
                      marginBottom: '0.1rem',
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {l.titulo}
                  </p>
                  {l.descricao && (
                    <p
                      style={{
                        fontSize: '0.8rem',
                        color: 'var(--text-muted)',
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {l.descricao}
                    </p>
                  )}
                  <p
                    style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-light)',
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {linkDomain(l.url)}
                  </p>
                </a>
                <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                  <Button
                    variant="ghost"
                    size="icon"
                    style={{ width: 28, height: 28 }}
                    onClick={() => openDialog(l)}
                    aria-label={`${t('detail.editLink')}: ${l.titulo}`}
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    style={{ width: 28, height: 28, color: 'var(--danger)' }}
                    onClick={() => setDeleteId(l.id!)}
                    aria-label={`${t('detail.removeLink')}: ${l.titulo}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <DialogContent
          style={{ maxWidth: 440 }}
          confirmClose={isDirty || isSubmitting}
          onConfirmClose={closeDialog}
        >
          <DialogHeader>
            <DialogTitle>{editing ? t('detail.editLink') : t('detail.newLink')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>{t('detail.linkTitle')}</Label>
                <Input
                  placeholder={t('detail.linkTitlePlaceholder')}
                  maxLength={120}
                  {...form.register('titulo')}
                />
                {errors.titulo && (
                  <p style={{ color: 'var(--danger-text)', fontSize: '0.8rem' }}>
                    {errors.titulo.message}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label>{t('detail.linkUrl')}</Label>
                <Input
                  placeholder={t('detail.linkUrlPlaceholder')}
                  inputMode="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  {...form.register('url')}
                />
                {errors.url && (
                  <p style={{ color: 'var(--danger-text)', fontSize: '0.8rem' }}>
                    {errors.url.message}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label>{t('detail.linkDescription')}</Label>
                <Input
                  placeholder={t('detail.linkDescriptionPlaceholder')}
                  maxLength={300}
                  {...form.register('descricao')}
                />
              </div>
            </div>
            <DialogFooter style={{ marginTop: '1rem' }}>
              <Button type="button" variant="outline" onClick={closeDialog}>
                {tc('actions.cancel')}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Spinner size="sm" />}{' '}
                {editing ? tc('actions.save') : tc('actions.add')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog
        open={deleteId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('detail.removeLink')}</AlertDialogTitle>
            <AlertDialogDescription>{t('detail.removeLinkConfirm')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>{tc('actions.delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default ClienteLinksSection;
