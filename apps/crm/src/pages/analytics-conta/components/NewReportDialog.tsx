// Cria um relatório interativo: mês (default = mês anterior) e geração
// síncrona. Seletor de template chega no PR 3, junto com a UI de templates.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { generateReportDoc } from '../../../services/reportDocs';

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
  const [month, setMonth] = useState(previousMonth);
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    if (generating || !month) return;
    setGenerating(true);
    try {
      const { id } = await generateReportDoc(clientId, month);
      toast.success('Relatório gerado.');
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
