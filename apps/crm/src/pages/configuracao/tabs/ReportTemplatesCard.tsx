// Modelos de relatório (spec 2026-09-25 §1): lista, cria, duplica, renomeia,
// define o padrão e exclui. Sem gate por configuracoes:editar: as policies de
// report_templates liberam o workspace inteiro (ver a spec, "Permissões").
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { i18n } from '@mesaas/i18n';
import { Copy, Eye, Lock, MoreHorizontal, Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ReportLayout } from '@mesaas/report-blocks/types';
import {
  buildSystemDefaultLayout,
  createReportTemplate,
  deleteReportTemplate,
  listReportTemplates,
  setDefaultReportTemplate,
  SYSTEM_TEMPLATE_NAME,
  updateReportTemplate,
  type ReportTemplateRow,
} from '../../../services/reportTemplates';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { ReportTemplatesPhone } from './phone/ReportTemplatesPhone';

const LIST_KEY = ['report-templates'] as const;
const detailKey = (id: string) => ['report-template', id] as const;
function blockCount(n: number): string {
  return i18n.t('settingsHub:templates.blockCount', { count: n });
}

const ROW_STYLE = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.75rem',
  padding: '0.65rem 0',
  borderBottom: '1px solid var(--border-color)',
} as const;

const META_STYLE = { fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.5rem' };

export function ReportTemplatesCard() {
  const { t } = useTranslation('settingsHub');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isPhone = !useIsDesktop(768);
  const { data: templates = [], isLoading } = useQuery({
    queryKey: LIST_KEY,
    queryFn: listReportTemplates,
  });
  const [renaming, setRenaming] = useState<ReportTemplateRow | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleting, setDeleting] = useState<ReportTemplateRow | null>(null);

  useEffect(() => {
    if (renaming) setRenameValue(renaming.name);
  }, [renaming]);

  const create = useMutation({
    mutationFn: ({ name, layout }: { name: string; layout: ReportLayout }) =>
      createReportTemplate(name, layout),
    onSuccess: async (row) => {
      await qc.invalidateQueries({ queryKey: LIST_KEY });
      navigate(`/relatorios/modelos/${row.id}`);
    },
    onError: () => toast.error(t('templates.toast.createError')),
  });

  const makeDefault = useMutation({
    mutationFn: (id: string) => setDefaultReportTemplate(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: LIST_KEY });
      toast.success(t('templates.toast.defaultUpdated'));
    },
    onError: () => toast.error(t('templates.toast.genericError')),
  });

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateReportTemplate(id, { name }),
    onSuccess: async (_data, { id }) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: LIST_KEY }),
        // O editor lê o detalhe com staleTime: Infinity: sem isso ele
        // reabriria com o nome antigo.
        qc.invalidateQueries({ queryKey: detailKey(id) }),
      ]);
      setRenaming(null);
      toast.success(t('templates.toast.renamed'));
    },
    onError: () => toast.error(t('templates.toast.genericError')),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteReportTemplate(id),
    onSuccess: async (_data, id) => {
      qc.removeQueries({ queryKey: detailKey(id) });
      await qc.invalidateQueries({ queryKey: LIST_KEY });
      setDeleting(null);
      toast.success(t('templates.toast.deleted'));
    },
    onError: () => toast.error(t('templates.toast.deleteError')),
  });

  const busy = create.isPending;

  if (isPhone) {
    // Phone: the same mutations behind a grouped list, a hold menu, a rename sheet and
    // an action-sheet confirm. The desktop Dialog/AlertDialog/DropdownMenu never mount.
    return (
      <ReportTemplatesPhone
        templates={templates}
        isLoading={isLoading}
        systemName={SYSTEM_TEMPLATE_NAME}
        busy={busy}
        onCreate={() =>
          create.mutate({ name: t('templates.newTemplate'), layout: buildSystemDefaultLayout() })
        }
        onViewSystem={() => navigate('/relatorios/modelos/padrao')}
        onDuplicateSystem={() =>
          create.mutate({
            name: t('templates.systemCopyName', { name: SYSTEM_TEMPLATE_NAME }),
            layout: buildSystemDefaultLayout(),
          })
        }
        onEdit={(tpl) => navigate(`/relatorios/modelos/${tpl.id}`)}
        onMakeDefault={(tpl) => makeDefault.mutate(tpl.id)}
        makeDefaultPending={makeDefault.isPending}
        onRename={setRenaming}
        onDuplicate={(tpl) =>
          create.mutate({ name: t('templates.copyOfName', { name: tpl.name }), layout: tpl.layout })
        }
        onDelete={setDeleting}
        renaming={renaming}
        renameValue={renameValue}
        onRenameValueChange={setRenameValue}
        onCloseRename={() => {
          if (!rename.isPending) setRenaming(null);
        }}
        onSubmitRename={() =>
          renaming && rename.mutate({ id: renaming.id, name: renameValue.trim() })
        }
        renamePending={rename.isPending}
        deleting={deleting}
        onConfirmDelete={() => {
          // Clear the target right away (the sheet already closed): a failed delete
          // must let the same row be confirmed again.
          if (deleting) remove.mutate(deleting.id);
          setDeleting(null);
        }}
        onCancelDelete={() => {
          if (!remove.isPending) setDeleting(null);
        }}
        removePending={remove.isPending}
        blockCount={blockCount}
      />
    );
  }

  return (
    <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '1rem',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h3 className="config-title">{t('templates.title')}</h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
            {t('templates.description')}
          </p>
        </div>
        <Button
          size="sm"
          disabled={busy}
          onClick={() =>
            create.mutate({ name: t('templates.newTemplate'), layout: buildSystemDefaultLayout() })
          }
        >
          <Plus className="h-3.5 w-3.5" /> {t('templates.newTemplate')}
        </Button>
      </div>

      <div style={{ marginTop: '0.75rem' }}>
        <div data-template-row="system" style={ROW_STYLE}>
          <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
            <Lock
              className="h-3.5 w-3.5"
              aria-hidden="true"
              style={{ color: 'var(--text-muted)', marginRight: '0.5rem' }}
            />
            <span>{SYSTEM_TEMPLATE_NAME}</span>
            <span style={META_STYLE}>{t('templates.builtIn')}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/relatorios/modelos/padrao')}
            >
              <Eye className="h-3.5 w-3.5" /> {t('templates.view')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                create.mutate({
                  name: t('templates.systemCopyName', { name: SYSTEM_TEMPLATE_NAME }),
                  layout: buildSystemDefaultLayout(),
                })
              }
            >
              <Copy className="h-3.5 w-3.5" /> {t('templates.duplicate')}
            </Button>
          </div>
        </div>

        {templates.map((tpl) => (
          <div key={tpl.id} data-template-row={tpl.id} style={ROW_STYLE}>
            <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
              <span>{tpl.name}</span>
              {tpl.is_default && (
                <span className="badge badge-neutral badge--sm" style={{ marginLeft: '0.5rem' }}>
                  {t('templates.defaultBadge')}
                </span>
              )}
              <span style={META_STYLE}>{blockCount(tpl.layout.blocks.length)}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(`/relatorios/modelos/${tpl.id}`)}
              >
                <Pencil className="h-3.5 w-3.5" /> {t('actions.edit')}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t('statusPhone.moreActionsOf', { name: tpl.name })}
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {!tpl.is_default && (
                    <DropdownMenuItem
                      disabled={makeDefault.isPending}
                      onSelect={() => makeDefault.mutate(tpl.id)}
                    >
                      {t('templates.makeDefault')}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onSelect={() => setRenaming(tpl)}>
                    {t('templates.rename')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={busy}
                    onSelect={() =>
                      create.mutate({
                        name: t('templates.copyOfName', { name: tpl.name }),
                        layout: tpl.layout,
                      })
                    }
                  >
                    {t('templates.duplicate')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setDeleting(tpl)}>
                    {t('templates.delete')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        ))}

        {!isLoading && templates.length === 0 && (
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.75rem 0 0' }}>
            {t('templates.empty')}
          </p>
        )}
      </div>

      <Dialog
        open={renaming !== null}
        onOpenChange={(open) => {
          if (!open && !rename.isPending) setRenaming(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('templates.renameTitle')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rename-template-name">{t('templates.nameLabel')}</Label>
            <Input
              id="rename-template-name"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)}>
              {t('actions.cancel')}
            </Button>
            <Button
              disabled={rename.isPending || !renameValue.trim()}
              onClick={() =>
                renaming && rename.mutate({ id: renaming.id, name: renameValue.trim() })
              }
            >
              {t('actions.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('templates.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('templates.deleteMessage', { name: deleting?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (deleting) remove.mutate(deleting.id);
              }}
            >
              {t('templates.deleteConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
