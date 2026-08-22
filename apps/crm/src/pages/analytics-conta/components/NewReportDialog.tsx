// Cria um relatório interativo: mês (default = mês anterior), template
// opcional e geração síncrona.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { MonthPicker } from '@/components/ui/month-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { generateReportDoc } from '../../../services/reportDocs';
import { listReportTemplates } from '../../../services/reportTemplates';

const SYSTEM_TEMPLATE = '__system';

function previousMonth(): string {
  const now = new Date();
  const y = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  const m = now.getUTCMonth() === 0 ? 12 : now.getUTCMonth();
  return `${y}-${String(m).padStart(2, '0')}`;
}

export interface NewReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: number;
}

export function NewReportDialog({ open, onOpenChange, clientId }: NewReportDialogProps) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [month, setMonth] = useState(previousMonth);
  const [templateId, setTemplateId] = useState(SYSTEM_TEMPLATE);
  const [generating, setGenerating] = useState(false);

  const { data: templates = [], isLoading: templatesLoading } = useQuery({
    queryKey: ['report-templates'],
    queryFn: listReportTemplates,
    enabled: open,
  });

  // Default: o template is_default do workspace, se existir; senão "Padrão
  // do sistema". Aplica só UMA vez por "sessão de abertura" -- na primeira
  // resolução da query após o dialog abrir. Sem o guard appliedDefaultRef,
  // qualquer refetch em segundo plano de ['report-templates'] (identidade
  // nova do array) enquanto o dialog segue aberto reaplicava o efeito e
  // jogava a escolha manual do usuário de volta pro default.
  const appliedDefaultRef = useRef(false);
  useEffect(() => {
    if (!open) {
      appliedDefaultRef.current = false;
      return;
    }
    if (appliedDefaultRef.current || templatesLoading) return;
    const def = templates.find((t) => t.is_default);
    setTemplateId(def ? def.id : SYSTEM_TEMPLATE);
    appliedDefaultRef.current = true;
  }, [open, templatesLoading, templates]);

  const handleGenerate = async () => {
    if (generating || !month) return;
    setGenerating(true);
    try {
      const { id } = await generateReportDoc(
        clientId,
        month,
        templateId !== SYSTEM_TEMPLATE ? templateId : undefined,
      );
      toast.success('Relatório gerado.');
      await qc.invalidateQueries({ queryKey: ['report-docs', clientId] });
      onOpenChange(false);
      navigate(`/relatorios/${id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao gerar relatório');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!generating) onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo relatório interativo</DialogTitle>
        </DialogHeader>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
          Gera o relatório com os dados do mês escolhido. Depois você edita os blocos, remove
          métricas e salva o layout como modelo.
        </p>
        <div className="space-y-1">
          <Label>Mês do relatório</Label>
          <MonthPicker value={month} onChange={setMonth} clearable={false} />
        </div>
        <div className="space-y-1" style={{ marginTop: '0.75rem' }}>
          <Label>Modelo</Label>
          <Select value={templateId} onValueChange={setTemplateId} disabled={generating}>
            <SelectTrigger aria-label="Modelo do relatório">
              <SelectValue placeholder="Padrão do sistema" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SYSTEM_TEMPLATE}>Padrão do sistema</SelectItem>
              {templates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                  {t.is_default ? ' · padrão' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={generating} onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={generating || !month} onClick={handleGenerate}>
            {generating ? <Spinner size="sm" /> : null}{' '}
            {generating ? 'Gerando…' : 'Gerar relatório'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
