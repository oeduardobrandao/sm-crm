import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Star, StarOff, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { useDateFnsLocale } from '@mesaas/i18n';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ListSkeleton } from '@/components/ui/skeletons';
import {
  deleteReportTemplate,
  listReportTemplates,
  setDefaultReportTemplate,
  type ReportTemplateRow,
} from '../../services/reportTemplates';

export interface ApplyTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (template: ReportTemplateRow) => void;
  warnImagesRemoved?: boolean;
}

export function ApplyTemplateDialog({
  open,
  onOpenChange,
  onApply,
  warnImagesRemoved,
}: ApplyTemplateDialogProps) {
  const { t } = useTranslation('reportEditor');
  const dateLocale = useDateFnsLocale();
  const qc = useQueryClient();
  // enabled: open evita chamar listReportTemplates enquanto o dialog nunca foi
  // aberto (este componente fica sempre montado na topbar do editor).
  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['report-templates'],
    queryFn: listReportTemplates,
    enabled: open,
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ['report-templates'] });
  }

  async function handleSetDefault(id: string) {
    try {
      await setDefaultReportTemplate(id);
      refresh();
      toast.success(t('applyTemplate.defaultSet'));
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : t('applyTemplate.defaultError');
      toast.error(message);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm(t('applyTemplate.deleteConfirm'))) return;
    try {
      await deleteReportTemplate(id);
      refresh();
      toast.success(t('applyTemplate.deleted'));
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : t('applyTemplate.deleteError');
      toast.error(message);
    }
  }

  function handleApply(tpl: ReportTemplateRow) {
    onApply(tpl);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('applyTemplate.title')}</DialogTitle>
        </DialogHeader>
        {warnImagesRemoved && (
          <p className="text-sm text-muted-foreground">{t('applyTemplate.imagesWarning')}</p>
        )}
        {isLoading ? (
          <ListSkeleton rows={3} />
        ) : templates.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">{t('applyTemplate.empty')}</p>
        ) : (
          <div className="space-y-2">
            {templates.map((tpl) => (
              <div
                key={tpl.id}
                data-testid="template-row"
                className="flex items-center justify-between border rounded-lg p-3 gap-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate flex items-center gap-1.5">
                    {tpl.is_default && (
                      <Star className="h-3.5 w-3.5 fill-primary text-primary shrink-0" />
                    )}
                    {tpl.name}
                    {tpl.is_default && (
                      <span className="text-xs text-primary font-semibold">
                        {t('applyTemplate.defaultBadge')}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(tpl.created_at), t('applyTemplate.dateFormat'), {
                      locale: dateLocale,
                    })}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {!tpl.is_default && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t('applyTemplate.setDefaultAria')}
                      onClick={() => handleSetDefault(tpl.id)}
                    >
                      <StarOff className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t('applyTemplate.deleteAria')}
                    onClick={() => handleDelete(tpl.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" onClick={() => handleApply(tpl)}>
                    {t('applyTemplate.apply')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
