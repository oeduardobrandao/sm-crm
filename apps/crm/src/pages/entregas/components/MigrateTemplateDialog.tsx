import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ArrowRightLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  buildMigrationEtapas,
  matchPropertyDefinitions,
  migrateWorkflowTemplate,
  getPropertyDefinitions,
  getWorkflowPostsWithProperties,
  OPTION_TYPES,
  type Cliente,
  type PropertyMatch,
  type Workflow,
  type WorkflowTemplate,
} from '../../../store';
import { getNextDeliveryDate } from '../hooks/useEntregasData';

const TIPO_PRAZO_LABEL: Record<'uteis' | 'corridos', string> = {
  uteis: 'dias úteis',
  corridos: 'dias corridos',
};

export function MigrateTemplateDialog({
  workflow,
  cliente,
  templates,
  onClose,
  onMigrated,
}: {
  workflow: Workflow;
  cliente: Cliente | undefined;
  templates: WorkflowTemplate[];
  onClose: () => void;
  onMigrated: () => void;
}) {
  const [destinoId, setDestinoId] = useState<string>('');
  const [activeOrdem, setActiveOrdem] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const candidatos = useMemo(
    () => templates.filter((t) => t.id !== workflow.template_id),
    [templates, workflow.template_id],
  );
  const destino = useMemo(
    () => candidatos.find((t) => String(t.id) === destinoId),
    [candidatos, destinoId],
  );

  const { data: defsOrigem = [] } = useQuery({
    queryKey: ['property-definitions', workflow.template_id],
    queryFn: () => getPropertyDefinitions(workflow.template_id!),
    enabled: workflow.template_id != null,
  });
  const { data: defsDestino = [] } = useQuery({
    queryKey: ['property-definitions', destino?.id],
    queryFn: () => getPropertyDefinitions(destino!.id!),
    enabled: destino?.id != null,
  });
  const { data: posts = [] } = useQuery({
    queryKey: ['workflow-posts-props', workflow.id],
    queryFn: () => getWorkflowPostsWithProperties(workflow.id!),
  });

  const matches = useMemo(
    () => (destino ? matchPropertyDefinitions(defsOrigem, defsDestino) : []),
    [destino, defsOrigem, defsDestino],
  );
  const perdidas = matches.filter((m) => m.destino === null);
  const migram = matches.filter((m) => m.destino !== null);
  // Duas definições de origem homônimas casando com a MESMA de destino: a RPC
  // mantém só um valor por post (menor display_order vence). A prévia precisa
  // dizer isso em vez de mostrar as duas como "preservadas".
  const destinoConflitos = useMemo(() => {
    const counts = new Map<number, number>();
    for (const m of migram) {
      const id = m.destino!.id!;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [migram]);
  const temConflito = (m: PropertyMatch) => (destinoConflitos.get(m.destino?.id ?? -1) ?? 0) > 1;
  const postsAfetados = (defId: number) =>
    posts.filter((p) => p.property_values.some((pv) => pv.property_definition_id === defId)).length;

  const etapasNovas = useMemo(() => {
    if (!destino) return [];
    const deliveryDate =
      (destino.modo_prazo ?? 'padrao') === 'data_entrega' && cliente?.dia_entrega
        ? getNextDeliveryDate(cliente.dia_entrega)
        : null;
    return buildMigrationEtapas(destino, deliveryDate);
  }, [destino, cliente]);

  const handleSelectDestino = (value: string) => {
    setDestinoId(value);
    setActiveOrdem(0);
  };

  const handleConfirm = async () => {
    if (!destino) return;
    setSaving(true);
    try {
      await migrateWorkflowTemplate({
        workflowId: workflow.id!,
        templateId: destino.id!,
        etapas: etapasNovas,
        activeOrdem,
        modoPrazo: (destino.modo_prazo ?? 'padrao') as 'padrao' | 'data_fixa' | 'data_entrega',
        expectedTemplateId: workflow.template_id ?? null,
        expectedEtapaAtual: workflow.etapa_atual,
      });
      toast.success('Fluxo migrado para o novo template.');
      onMigrated();
      onClose();
    } catch (err: unknown) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
      setConfirmOpen(false);
    }
  };

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4" /> Migrar template do fluxo
            </DialogTitle>
            <DialogDescription>
              Troque o template usado por "{workflow.titulo}" preservando o que for possível.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* 1. Select "Template de destino" */}
            <div className="space-y-1">
              <Label htmlFor="destino-template">Template de destino</Label>
              <Select value={destinoId} onValueChange={handleSelectDestino}>
                <SelectTrigger id="destino-template" aria-label="Template de destino">
                  <SelectValue placeholder="Selecione um template" />
                </SelectTrigger>
                <SelectContent>
                  {candidatos.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {candidatos.length === 0 && (
                <p className="text-sm text-muted-foreground">Nenhum outro template disponível.</p>
              )}
            </div>

            {destino && (
              <>
                {/* 2. Select "Em qual etapa este fluxo está agora?" */}
                <div className="space-y-1">
                  <Label htmlFor="etapa-atual">Em qual etapa este fluxo está agora?</Label>
                  <Select
                    value={String(activeOrdem)}
                    onValueChange={(v) => setActiveOrdem(Number(v))}
                  >
                    <SelectTrigger id="etapa-atual" aria-label="Etapa atual do fluxo">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {etapasNovas.map((e, i) => (
                        <SelectItem key={i} value={String(i)}>
                          {i + 1}. {e.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* 3. Prévia: etapas novas + propriedades */}
                <div className="space-y-1">
                  <Label>Novas etapas</Label>
                  <ul className="space-y-1 text-sm">
                    {etapasNovas.map((e, i) => (
                      <li key={i}>
                        {i + 1}. {e.nome} · {e.prazo_dias} {TIPO_PRAZO_LABEL[e.tipo_prazo]}
                        {e.data_limite &&
                          ` · prazo: ${format(parseISO(e.data_limite), 'dd/MM/yyyy', { locale: ptBR })}`}
                      </li>
                    ))}
                  </ul>
                </div>

                {defsOrigem.length > 0 && (
                  <div className="space-y-1">
                    <Label>Propriedades</Label>
                    <ul className="space-y-1 text-sm">
                      {migram.map((m) =>
                        temConflito(m) ? (
                          <li key={m.origem.id} className="text-amber-600">
                            {m.origem.name} · campos de origem com o mesmo nome: um valor por post
                            será mantido, os demais serão descartados.
                          </li>
                        ) : (
                          <li key={m.origem.id} className="text-emerald-600">
                            {m.origem.name} · valores preservados.
                          </li>
                        ),
                      )}
                      {perdidas.map((m) => (
                        <li key={m.origem.id} className="text-red-600">
                          {m.origem.name} · valores de {postsAfetados(m.origem.id!)} post(s) serão
                          perdidos.
                          {OPTION_TYPES.has(m.origem.type) &&
                            ' Opções de seleção não migram entre templates.'}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}

            {/* 4. Aviso fixo */}
            <p className="text-sm text-muted-foreground">
              Os posts, aprovações e comentários deste fluxo não serão alterados. A troca de etapas
              não pode ser desfeita automaticamente.
            </p>
          </div>

          {/* 5. Rodapé */}
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button onClick={() => setConfirmOpen(true)} disabled={!destino}>
              <ArrowRightLeft className="h-4 w-4" /> Migrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Migrar "{workflow.titulo}" para {destino?.nome}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {perdidas.length > 0
                ? `${perdidas.length} propriedade(s) terão valores perdidos nesta migração.`
                : 'Nenhuma propriedade será perdida nesta migração.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} disabled={saving}>
              {saving && <Spinner size="sm" />} Confirmar migração
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
