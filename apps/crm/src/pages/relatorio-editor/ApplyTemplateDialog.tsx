import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Star, StarOff, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
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
}

export function ApplyTemplateDialog({ open, onOpenChange, onApply }: ApplyTemplateDialogProps) {
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
      toast.success('Template padrão definido.');
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Erro ao definir template padrão.';
      toast.error(message);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Excluir este template? Essa ação não pode ser desfeita.')) return;
    try {
      await deleteReportTemplate(id);
      refresh();
      toast.success('Template excluído.');
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Erro ao excluir template.';
      toast.error(message);
    }
  }

  function handleApply(t: ReportTemplateRow) {
    onApply(t);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Aplicar template</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : templates.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            Nenhum template salvo ainda. Use Salvar como template no editor.
          </p>
        ) : (
          <div className="space-y-2">
            {templates.map((t) => (
              <div
                key={t.id}
                data-testid="template-row"
                className="flex items-center justify-between border rounded-lg p-3 gap-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate flex items-center gap-1.5">
                    {t.is_default && (
                      <Star className="h-3.5 w-3.5 fill-primary text-primary shrink-0" />
                    )}
                    {t.name}
                    {t.is_default && (
                      <span className="text-xs text-primary font-semibold">Padrão</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(t.created_at), "d 'de' MMMM 'de' yyyy", { locale: ptBR })}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {!t.is_default && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Definir como padrão"
                      onClick={() => handleSetDefault(t.id)}
                    >
                      <StarOff className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Excluir template"
                    onClick={() => handleDelete(t.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" onClick={() => handleApply(t)}>
                    Aplicar
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
