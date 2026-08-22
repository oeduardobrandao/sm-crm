import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ReportLayout } from '@mesaas/report-blocks/types';
import { createReportTemplate, setDefaultReportTemplate } from '../../services/reportTemplates';
import { stripAiTextForTemplate } from './templateOps';

export interface SaveTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  getLayout: () => ReportLayout;
}

export function SaveTemplateDialog({ open, onOpenChange, getLayout }: SaveTemplateDialogProps) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [makeDefault, setMakeDefault] = useState(false);
  const [saving, setSaving] = useState(false);

  // Estado limpo a cada abertura: sem isso, reabrir o dialog depois de um
  // save anterior mostraria o nome e o checkbox da última vez.
  useEffect(() => {
    if (open) {
      setName('');
      setMakeDefault(false);
    }
  }, [open]);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const stripped = stripAiTextForTemplate(getLayout());
      const created = await createReportTemplate(trimmed, stripped);
      if (makeDefault) await setDefaultReportTemplate(created.id);
      qc.invalidateQueries({ queryKey: ['report-templates'] });
      toast.success('Template salvo.');
      onOpenChange(false);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Erro ao salvar template.';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Salvar como template</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="save-template-name">Nome do template</Label>
            <Input
              id="save-template-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Relatório mensal padrão"
              autoFocus
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="save-template-default"
              checked={makeDefault}
              onCheckedChange={(v) => setMakeDefault(v === true)}
            />
            <Label htmlFor="save-template-default" className="font-normal">
              Definir como padrão do workspace
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? 'Salvando…' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
