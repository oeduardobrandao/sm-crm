// Cria um relatório interativo: mês (default = mês anterior), template
// opcional e geração síncrona.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ExternalLink } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { captureEvent } from '@/lib/analytics';
import { useAuth } from '../../../context/AuthContext';

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
  const { can } = useAuth();
  const [month, setMonth] = useState(previousMonth);
  const [templateId, setTemplateId] = useState(SYSTEM_TEMPLATE);
  const [generating, setGenerating] = useState(false);

  // Só quem abre a aba (configTabs.ts: configuracoes:ver) vê o link.
  const canSeeTemplates = can('configuracoes', 'ver') === true;

  const { data: templates = [], isLoading: templatesLoading } = useQuery({
    queryKey: ['report-templates'],
    queryFn: listReportTemplates,
    enabled: open,
    // O link abaixo abre os modelos em outra aba. O QueryClient global tem
    // staleTime de 30s, então sem 'always' um modelo criado lá e uma volta
    // rápida manteriam a lista antiga no select.
    refetchOnWindowFocus: 'always',
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
      // "system" é a sentinela explícita do "Padrão do sistema": tem que ir
      // verbatim, nunca ser omitida. Omitir (o bug original, achado de
      // review externo em PR #379) faz o servidor usar o template is_default
      // do workspace quando ele existe -- exatamente o layout que o usuário
      // pediu para NÃO usar ao escolher "Padrão do sistema" explicitamente.
      const { id } = await generateReportDoc(
        clientId,
        month,
        templateId === SYSTEM_TEMPLATE ? 'system' : templateId,
      );
      toast.success('Relatório gerado.');
      captureEvent('report_generated');
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
          <DialogTitle>Novo relatório</DialogTitle>
          <DialogDescription>
            Gera o relatório com os dados do mês escolhido. Depois você edita os blocos, remove
            métricas e salva o layout como modelo.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-report-month">Mês do relatório</Label>
            <MonthPicker
              id="new-report-month"
              value={month}
              onChange={setMonth}
              clearable={false}
              disabled={generating}
              className="w-full"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <Label htmlFor="new-report-template">Modelo</Label>
              {canSeeTemplates && (
                <a
                  href="/configuracao/relatorios"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  Ver e editar modelos <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              )}
            </div>
            <Select value={templateId} onValueChange={setTemplateId} disabled={generating}>
              <SelectTrigger id="new-report-template" aria-label="Modelo do relatório">
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
