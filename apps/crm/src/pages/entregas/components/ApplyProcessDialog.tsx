import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  applyPostProcess,
  getClientes,
  getWorkflowTemplates,
  type ApplyPostProcessResult,
  type Membro,
} from '../../../store';
import { buildTemplateFingerprint } from '../fingerprint';
import { buildApplyPlan } from '../applyProcessDeadlines';
import { getNextDeliveryDate } from '../hooks/useEntregasData';
import { formatEtapaDeadlineDay } from '../etapaPrazo';
import { getPostProcessErrorToast, isStaleStateError } from '../postProcessErrors';
import { mesesDeEntrega } from '../wizard/steps/StepPrazos';

export interface ApplyProcessDialogProps {
  open: boolean;
  onClose: () => void;
  post: { id: number; titulo: string | null; cliente_id: number | null };
  membros: Membro[];
  onApplied: (result: ApplyPostProcessResult) => void;
  /** Pré-seleciona o modelo (quick-add "Post individual" com modo_prazo !=
   *  'padrao', spec §3): o usuário só completa etapa inicial/datas, sem
   *  escolher o template de novo. */
  initialTemplateId?: number;
}

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/**
 * Aplicar um template de processo a um avulso (spec §5.2, §7). A sequência
 * vem do template; o diálogo só escolhe template, etapa inicial, responsáveis
 * e prazos, e mostra o resultado antes de confirmar. Confirmar fica
 * desabilitado com o motivo enquanto buildApplyPlan devolver bloqueios.
 */
export function ApplyProcessDialog({
  open,
  onClose,
  post,
  membros,
  onApplied,
  initialTemplateId,
}: ApplyProcessDialogProps) {
  const { t } = useTranslation('workflows');
  const qc = useQueryClient();
  const { data: templates = [] } = useQuery({
    queryKey: ['workflow-templates'],
    queryFn: getWorkflowTemplates,
    enabled: open,
  });
  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: getClientes,
    enabled: open,
  });
  const cliente = clientes.find((c) => c.id === post.cliente_id);
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [startOrdem, setStartOrdem] = useState(0);
  const [responsaveis, setResponsaveis] = useState<Record<number, number | null | undefined>>({});
  const [fixedDates, setFixedDates] = useState<Record<number, string | undefined>>({});
  const [month, setMonth] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const template = templates.find((tpl) => tpl.id === templateId) ?? null;

  // Reset only on open/target-post change — NOT on `cliente?.dia_entrega`. `getClientes` and
  // `getWorkflowTemplates` are two independent queries; if templates resolve first, the user can
  // already be picking a template and filling responsáveis/prazos before `getClientes` resolves.
  // Keying this on `cliente?.dia_entrega` would then wipe that in-progress selection the instant
  // the client query settles (P2 review finding, 2026-09-11 — confirmed against this exact code).
  useEffect(() => {
    if (!open) return;
    setTemplateId(initialTemplateId ?? null);
    setStartOrdem(0);
    setResponsaveis({});
    setFixedDates({});
    setMonth('');
    // initialTemplateId só deve valer no primeiro open — não re-executar
    // a cada render por causa dele quando o pai o mantém estável por post.id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, post.id]);
  // Delivery-month default is set separately, once the client's dia_entrega is known — this can
  // still re-run after the reset above without touching template/responsável/prazo selections.
  useEffect(() => {
    if (!open || !cliente?.dia_entrega) return;
    setMonth((m) => (m ? m : monthKey(getNextDeliveryDate(cliente.dia_entrega!))));
  }, [open, cliente?.dia_entrega]);
  useEffect(() => {
    setStartOrdem(0);
    setResponsaveis({});
    setFixedDates({});
  }, [templateId]);

  const deliveryDate = useMemo(() => {
    if (!cliente?.dia_entrega || !/^\d{4}-\d{2}$/.test(month)) return null;
    const [y, m] = month.split('-').map(Number);
    const days = new Date(y, m, 0).getDate();
    return new Date(y, m - 1, Math.min(cliente.dia_entrega, days));
  }, [cliente?.dia_entrega, month]);

  const plan = useMemo(
    () =>
      template
        ? buildApplyPlan({
            template,
            startOrdem,
            now: new Date(),
            fixedDates,
            deliveryDate,
            clienteHasDiaEntrega: !!cliente?.dia_entrega,
            responsaveis,
          })
        : null,
    [template, startOrdem, fixedDates, deliveryDate, cliente?.dia_entrega, responsaveis],
  );
  const blocker = !template ? t('applyProcess.chooseTemplate') : plan?.blockers[0];

  const confirm = async () => {
    if (!template || !plan || blocker) return;
    setBusy(true);
    try {
      const result = await applyPostProcess({
        postId: post.id,
        templateId: template.id!,
        templateFingerprint: buildTemplateFingerprint(template.etapas),
        startOrdem,
        stepOverrides: plan.overrides,
      });
      toast.success(t('applyProcess.applied'));
      for (const key of [
        ['post-processes'],
        ['post-process', post.id],
        ['post-process-events'],
        ['active-posts'],
        ['standalone-post', post.id],
      ])
        qc.invalidateQueries({ queryKey: key });
      onApplied(result);
      onClose();
    } catch (err) {
      toast.error(getPostProcessErrorToast(err, t('applyProcess.applyError')));
      if (isStaleStateError(err)) {
        qc.invalidateQueries({ queryKey: ['workflow-templates'] });
        qc.invalidateQueries({ queryKey: ['post-process', post.id] });
        qc.invalidateQueries({ queryKey: ['post-processes'] });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t('applyProcess.title')}</DialogTitle>
          <DialogDescription>
            {t('applyProcess.desc', { title: post.titulo || t('shared.postUntitled') })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Select
            value={templateId != null ? String(templateId) : ''}
            onValueChange={(v) => setTemplateId(Number(v))}
          >
            <SelectTrigger aria-label={t('applyProcess.templateAria')}>
              <SelectValue placeholder={t('applyProcess.choosePlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {templates.map((tpl) => (
                <SelectItem
                  key={tpl.id}
                  value={String(tpl.id)}
                  disabled={!Array.isArray(tpl.etapas) || tpl.etapas.length === 0}
                >
                  {tpl.nome}
                  {!Array.isArray(tpl.etapas) || tpl.etapas.length === 0
                    ? t('applyProcess.noStages')
                    : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {template && plan && (
            <>
              <Select value={String(startOrdem)} onValueChange={(v) => setStartOrdem(Number(v))}>
                <SelectTrigger aria-label={t('applyProcess.startStageAria')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {template.etapas.map((e, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {e.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {plan.modo === 'data_entrega' && (
                <label className="text-sm flex flex-col gap-1">
                  {cliente?.dia_entrega
                    ? t('applyProcess.deliveryMonthWithDay', { day: cliente.dia_entrega })
                    : t('applyProcess.deliveryMonth')}
                  <Select value={month} onValueChange={setMonth}>
                    <SelectTrigger aria-label={t('applyProcess.deliveryMonth')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {mesesDeEntrega().map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              )}
              <ul className="history-timeline text-sm">
                {plan.steps.map((s) => (
                  <li key={s.ordem} className="flex flex-col gap-1 py-1">
                    <span>
                      <strong>{s.nome}</strong> ·{' '}
                      <span>{t(`applyProcess.estado.${s.estado}`)}</span>
                      {s.tipo === 'aprovacao_cliente'
                        ? ` · ${t('applyProcess.clientApproval')}`
                        : ''}
                    </span>
                    {s.estado !== 'ignorado' && (
                      <span className="flex flex-wrap gap-2 items-center">
                        <Select
                          value={s.responsavelId != null ? String(s.responsavelId) : 'none'}
                          onValueChange={(v) =>
                            setResponsaveis((r) => ({
                              ...r,
                              [s.ordem]: v === 'none' ? null : Number(v),
                            }))
                          }
                        >
                          <SelectTrigger
                            aria-label={t('applyProcess.assigneeAria', { name: s.nome })}
                            className="h-7 w-44 text-xs"
                          >
                            <SelectValue placeholder={t('shared.noAssignee')} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">{t('shared.noAssignee')}</SelectItem>
                            {membros.map((m) => (
                              <SelectItem key={m.id} value={String(m.id)}>
                                {m.nome}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {plan.modo === 'data_fixa' ? (
                          <input
                            type="date"
                            aria-label={t('applyProcess.dateAria', { name: s.nome })}
                            value={fixedDates[s.ordem] ?? ''}
                            onChange={(e) =>
                              setFixedDates((d) => ({
                                ...d,
                                [s.ordem]: e.target.value || undefined,
                              }))
                            }
                            className="h-7 rounded-md border border-input px-2 text-xs"
                          />
                        ) : (
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            {s.prazoEfetivo
                              ? formatEtapaDeadlineDay(new Date(s.prazoEfetivo))
                              : t('applyProcess.deadlineOnActivate')}
                          </span>
                        )}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          {blocker && (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {blocker}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t('actions.cancel')}
          </Button>
          <Button type="button" onClick={confirm} disabled={busy || !!blocker}>
            {busy ? t('applyProcess.applying') : t('applyProcess.title')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
