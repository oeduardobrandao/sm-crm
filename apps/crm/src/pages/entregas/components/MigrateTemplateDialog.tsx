import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { useDateFnsLocale } from '@mesaas/i18n';
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
  const { t } = useTranslation('workflows');
  const dateLocale = useDateFnsLocale();
  const [destinoId, setDestinoId] = useState<string>('');
  const [activeOrdem, setActiveOrdem] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const candidatos = useMemo(
    () => templates.filter((tpl) => tpl.id !== workflow.template_id),
    [templates, workflow.template_id],
  );
  const destino = useMemo(
    () => candidatos.find((tpl) => String(tpl.id) === destinoId),
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
      toast.success(t('migrateTemplate.migrated'));
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
              <ArrowRightLeft className="h-4 w-4" /> {t('migrateTemplate.title')}
            </DialogTitle>
            <DialogDescription>
              {t('migrateTemplate.desc', { title: workflow.titulo })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* 1. Select "Template de destino" */}
            <div className="space-y-1">
              <Label htmlFor="destino-template">{t('migrateTemplate.target')}</Label>
              <Select value={destinoId} onValueChange={handleSelectDestino}>
                <SelectTrigger id="destino-template" aria-label={t('migrateTemplate.target')}>
                  <SelectValue placeholder={t('migrateTemplate.selectTemplate')} />
                </SelectTrigger>
                <SelectContent>
                  {candidatos.map((tpl) => (
                    <SelectItem key={tpl.id} value={String(tpl.id)}>
                      {tpl.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {candidatos.length === 0 && (
                <p className="text-sm text-muted-foreground">{t('migrateTemplate.noOther')}</p>
              )}
            </div>

            {destino && (
              <>
                {/* 2. Select "Em qual etapa este fluxo está agora?" */}
                <div className="space-y-1">
                  <Label htmlFor="etapa-atual">{t('migrateTemplate.currentStageQuestion')}</Label>
                  <Select
                    value={String(activeOrdem)}
                    onValueChange={(v) => setActiveOrdem(Number(v))}
                  >
                    <SelectTrigger
                      id="etapa-atual"
                      aria-label={t('migrateTemplate.currentStageAria')}
                    >
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
                  <Label>{t('migrateTemplate.newStages')}</Label>
                  <ul className="space-y-1 text-sm">
                    {etapasNovas.map((e, i) => (
                      <li key={i}>
                        {i + 1}. {e.nome} ·{' '}
                        {t(
                          e.tipo_prazo === 'uteis'
                            ? 'migrateTemplate.daysUteis'
                            : 'migrateTemplate.daysCorridos',
                          { n: e.prazo_dias },
                        )}
                        {e.data_limite &&
                          ` · ${t('migrateTemplate.deadline', {
                            date: format(parseISO(e.data_limite), t('shared.dateShort'), {
                              locale: dateLocale,
                            }),
                          })}`}
                      </li>
                    ))}
                  </ul>
                </div>

                {defsOrigem.length > 0 && (
                  <div className="space-y-1">
                    <Label>{t('migrateTemplate.properties')}</Label>
                    <ul className="space-y-1 text-sm">
                      {migram.map((m) =>
                        temConflito(m) ? (
                          <li key={m.origem.id} className="text-amber-600">
                            {m.origem.name} · {t('migrateTemplate.conflict')}
                          </li>
                        ) : (
                          <li key={m.origem.id} className="text-emerald-600">
                            {m.origem.name} · {t('migrateTemplate.preserved')}
                          </li>
                        ),
                      )}
                      {perdidas.map((m) => (
                        <li key={m.origem.id} className="text-red-600">
                          {m.origem.name} ·{' '}
                          {t('migrateTemplate.lost', { n: postsAfetados(m.origem.id!) })}
                          {OPTION_TYPES.has(m.origem.type) &&
                            ` ${t('migrateTemplate.optionsNoMigrate')}`}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}

            {/* 4. Aviso fixo */}
            <p className="text-sm text-muted-foreground">{t('migrateTemplate.notice')}</p>
          </div>

          {/* 5. Rodapé */}
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t('actions.cancel')}
            </Button>
            <Button onClick={() => setConfirmOpen(true)} disabled={!destino}>
              <ArrowRightLeft className="h-4 w-4" /> {t('migrateTemplate.migrate')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('migrateTemplate.confirmTitle', { title: workflow.titulo, target: destino?.nome })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {perdidas.length > 0
                ? t('migrateTemplate.lostCount', { n: perdidas.length })
                : t('migrateTemplate.noneLost')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} disabled={saving}>
              {saving && <Spinner size="sm" />} {t('migrateTemplate.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
