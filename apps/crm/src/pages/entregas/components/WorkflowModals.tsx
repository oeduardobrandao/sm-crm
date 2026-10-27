import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { i18n, useIntlLocale } from '@mesaas/i18n';
import type { PlatformId } from '@mesaas/platforms';
import { Trash2, Edit2, FileText, Settings, ArrowRightLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { PlatformChips, usePlatformChipsVisible } from '@/components/PlatformChips';
import { entitlementMessage, mapEntitlementError } from '@/lib/entitlement-errors';
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
  addWorkflowTemplate,
  removeWorkflowTemplate,
  removeWorkflow,
  updateWorkflow,
  updateWorkflowEtapa,
  saveWorkflowTemplate,
  getPropertyDefinitions,
  deletePropertyDefinition,
  type WorkflowTemplate,
  type Cliente,
  type Membro,
  type TemplatePropertyDefinition,
} from '../../../store';
import type { BoardCard } from '../hooks/useEntregasData';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { PhoneConfirmSheet } from '../phone/PhoneConfirmSheet';
import { PropertyDefinitionPanel } from './PropertyDefinitionPanel';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import { FormRow } from '@/components/mobile/FormRow';
import { PickerCell } from '@/components/mobile/PickerSheet';
import './editWorkflowPhone.css';
import { MigrateTemplateDialog } from './MigrateTemplateDialog';
import {
  SortableEtapaList,
  defaultEtapa,
  findInvalidPrazoEtapa,
  MAX_PRAZO_DIAS,
  type EtapaFormData,
  type ModoPrazo,
} from './SortableEtapaList';

// ---- Edit Workflow Modal ----
// feature_disabled:feature_multiplatform (quadro {geral} num workspace sem a flag)
// e demais erros de plano viram texto legível em vez do código do banco.
function saveErrorMessage(err: unknown): string {
  const entitlement = mapEntitlementError(err);
  return entitlement
    ? entitlementMessage(entitlement)
    : (err as Error).message || i18n.t('workflows:shared.genericError');
}

export function EditWorkflowModal({
  card,
  membros,
  clientes,
  templates,
  onClose,
  onSaved,
  onDeleted,
  onOpenPosts,
}: {
  card: BoardCard;
  membros: Membro[];
  clientes: Cliente[];
  templates: WorkflowTemplate[];
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
  onOpenPosts?: () => void;
}) {
  const { t } = useTranslation('workflows');
  const intlLocale = useIntlLocale();
  const w = card.workflow;
  const e = card.etapa;
  const modoPrazo: ModoPrazo = (w.modo_prazo as ModoPrazo) || 'padrao';
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [migrateOpen, setMigrateOpen] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [fTitulo, setFTitulo] = useState(w.titulo);
  const [fClienteId, setFClienteId] = useState(String(w.cliente_id));
  const [fRecorrente, setFRecorrente] = useState(w.recorrente || false);
  const [fPlataformas, setFPlataformas] = useState<PlatformId[]>(w.plataformas ?? ['instagram']);
  const showPlataformas = usePlatformChipsVisible(fPlataformas);
  const [fResponsavelId, setFResponsavelId] = useState(String(e.responsavel_id || ''));
  const [fPrazoDias, setFPrazoDias] = useState(String(e.prazo_dias));
  const [fTipoPrazo, setFTipoPrazo] = useState(e.tipo_prazo);
  const [fDataLimite, setFDataLimite] = useState(e.data_limite || '');
  const activeClientes = clientes
    .filter((c) => c.status === 'ativo')
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const isPhone = !useIsDesktop(768);

  const markDirty = () => setIsDirty(true);

  const handleSave = async () => {
    if (!fTitulo || !fClienteId) {
      toast.error(t('editWorkflowModal.requiredFields'));
      return;
    }
    setSaving(true);
    try {
      await updateWorkflow(w.id!, {
        titulo: fTitulo,
        cliente_id: Number(fClienteId),
        recorrente: fRecorrente,
        plataformas: fPlataformas,
      });
      const etapaUpdate: Parameters<typeof updateWorkflowEtapa>[1] = {
        responsavel_id: fResponsavelId ? Number(fResponsavelId) : null,
      };
      if (modoPrazo === 'padrao') {
        etapaUpdate.prazo_dias = Number(fPrazoDias) || e.prazo_dias;
        etapaUpdate.tipo_prazo = fTipoPrazo as 'corridos' | 'uteis';
      } else if (modoPrazo === 'data_fixa') {
        etapaUpdate.data_limite = fDataLimite || null;
      }
      await updateWorkflowEtapa(e.id!, etapaUpdate);
      toast.success(t('editWorkflowModal.updated'));
      onSaved();
      onClose();
    } catch (err: unknown) {
      toast.error(saveErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      await removeWorkflow(w.id!);
      toast.success(t('editWorkflowModal.deleted'));
      onDeleted();
      onClose();
    } catch {
      toast.error(t('editWorkflowModal.deleteError'));
    }
  };

  return (
    <>
      <Dialog
        open={true}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DialogContent onConfirmClose={onClose} confirmClose={isDirty}>
          <DialogHeader>
            <DialogTitle>{t('editWorkflowModal.title')}</DialogTitle>
          </DialogHeader>
          {isPhone ? (
            <EditWorkflowPhoneBody
              {...{
                card,
                membros,
                activeClientes,
                modoPrazo,
                isDirty,
                saving,
                showPlataformas,
                fTitulo,
                fClienteId,
                fRecorrente,
                fPlataformas,
                fResponsavelId,
                fPrazoDias,
                fTipoPrazo,
                fDataLimite,
              }}
              onChange={(patch) => {
                if (patch.fTitulo !== undefined) setFTitulo(patch.fTitulo);
                if (patch.fClienteId !== undefined) setFClienteId(patch.fClienteId);
                if (patch.fRecorrente !== undefined) setFRecorrente(patch.fRecorrente);
                if (patch.fPlataformas !== undefined) setFPlataformas(patch.fPlataformas);
                if (patch.fResponsavelId !== undefined) setFResponsavelId(patch.fResponsavelId);
                if (patch.fPrazoDias !== undefined) setFPrazoDias(patch.fPrazoDias);
                if (patch.fTipoPrazo !== undefined) setFTipoPrazo(patch.fTipoPrazo);
                if (patch.fDataLimite !== undefined) setFDataLimite(patch.fDataLimite);
                markDirty();
              }}
              onMigrate={() => setMigrateOpen(true)}
              onOpenPosts={onOpenPosts}
              onSave={handleSave}
              onDelete={() => setDeleteOpen(true)}
            />
          ) : (
            <>
              <div className="edit-modal-toolbar">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setMigrateOpen(true)}
                  disabled={isDirty}
                >
                  <ArrowRightLeft className="h-4 w-4" /> {t('shared.migrateTemplate')}
                </Button>
                {onOpenPosts && (
                  <Button variant="outline" size="sm" onClick={onOpenPosts}>
                    <FileText className="h-4 w-4" /> {t('shared.posts')}
                  </Button>
                )}
                {isDirty && (
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    {t('shared.saveBeforeMigrate')}
                  </span>
                )}
              </div>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label>{t('shared.titleRequiredLabel')}</Label>
                  <Input
                    value={fTitulo}
                    onChange={(e) => {
                      setFTitulo(e.target.value);
                      markDirty();
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t('shared.clientRequiredLabel')}</Label>
                  <Select
                    value={fClienteId}
                    onValueChange={(v) => {
                      setFClienteId(v);
                      markDirty();
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {activeClientes.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="recorrente-edit"
                    checked={fRecorrente}
                    onCheckedChange={(v) => {
                      setFRecorrente(!!v);
                      markDirty();
                    }}
                  />
                  <Label htmlFor="recorrente-edit">{t('shared.recurringWorkflow')}</Label>
                </div>
                {showPlataformas && (
                  <div className="space-y-1">
                    <Label>{t('shared.platforms')}</Label>
                    <PlatformChips
                      value={fPlataformas}
                      onChange={(v) => {
                        setFPlataformas(v);
                        markDirty();
                      }}
                    />
                    <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0 }}>
                      {t('shared.platformsHint')}
                    </p>
                  </div>
                )}
                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '0.75rem',
                    }}
                  >
                    <h4>{t('editWorkflowModal.currentStage', { name: e.nome })}</h4>
                    {modoPrazo !== 'padrao' && (
                      <span
                        style={{
                          fontSize: '0.72rem',
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: 10,
                          background: modoPrazo === 'data_entrega' ? '#dbeafe' : '#f3e8ff',
                          color: modoPrazo === 'data_entrega' ? '#1d4ed8' : '#7e22ce',
                        }}
                      >
                        {modoPrazo === 'data_entrega'
                          ? t('shared.deliveryDate')
                          : t('shared.fixedDate')}
                      </span>
                    )}
                  </div>
                  <div className="space-y-1">
                    <Label>{t('shared.assignee')}</Label>
                    <Select
                      value={fResponsavelId || '__none__'}
                      onValueChange={(val) => {
                        setFResponsavelId(val === '__none__' ? '' : val);
                        markDirty();
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t('shared.noAssignee')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">{t('shared.noAssignee')}</SelectItem>
                        {[...membros]
                          .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
                          .map((m) => (
                            <SelectItem key={m.id} value={String(m.id)}>
                              {m.nome}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {modoPrazo === 'padrao' && (
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: '1rem',
                        marginTop: '0.75rem',
                      }}
                    >
                      <div className="space-y-1">
                        <Label>{t('shared.deadlineDays')}</Label>
                        <Input
                          type="number"
                          min={1}
                          value={fPrazoDias}
                          onChange={(e) => {
                            setFPrazoDias(e.target.value);
                            markDirty();
                          }}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>{t('shared.deadlineType')}</Label>
                        <Select
                          value={fTipoPrazo}
                          onValueChange={(v) => {
                            setFTipoPrazo(v as 'corridos' | 'uteis');
                            markDirty();
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="corridos">{t('shared.calendarDays')}</SelectItem>
                            <SelectItem value="uteis">{t('shared.businessDays')}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}
                  {modoPrazo === 'data_fixa' && (
                    <div className="space-y-1" style={{ marginTop: '0.75rem' }}>
                      <Label>{t('shared.dueDate')}</Label>
                      <Input
                        type="date"
                        value={fDataLimite}
                        onChange={(ev) => {
                          setFDataLimite(ev.target.value);
                          markDirty();
                        }}
                      />
                    </div>
                  )}
                  {modoPrazo === 'data_entrega' && e.data_limite && (
                    <div
                      style={{
                        marginTop: '0.75rem',
                        padding: '0.5rem 0.75rem',
                        background: '#eff6ff',
                        borderRadius: 6,
                        fontSize: '0.82rem',
                        color: '#1d4ed8',
                      }}
                    >
                      {t('editWorkflowModal.computedDueDate')}{' '}
                      <strong>
                        {new Date(e.data_limite + 'T00:00:00').toLocaleDateString(intlLocale)}
                      </strong>
                    </div>
                  )}
                </div>
              </div>
              <div className="edit-modal-footer">
                <div className="edit-modal-footer-secondary">
                  <Button
                    variant="outline"
                    className="text-destructive"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 className="h-4 w-4" /> {t('shared.delete')}
                  </Button>
                </div>
                <div className="edit-modal-footer-primary">
                  <Button variant="outline" onClick={onClose}>
                    {t('actions.cancel')}
                  </Button>
                  <Button onClick={handleSave} disabled={saving}>
                    {saving && <Spinner size="sm" />} {t('actions.save')}
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('editWorkflowModal.deleteTitle', { title: w.titulo })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('shared.irreversible')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>{t('shared.delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {migrateOpen && (
        <MigrateTemplateDialog
          workflow={w}
          cliente={card.cliente}
          templates={templates}
          onClose={() => setMigrateOpen(false)}
          onMigrated={() => {
            onSaved();
            onClose();
          }}
        />
      )}
    </>
  );
}

interface EditWorkflowFields {
  fTitulo: string;
  fClienteId: string;
  fRecorrente: boolean;
  fPlataformas: PlatformId[];
  fResponsavelId: string;
  fPrazoDias: string;
  fTipoPrazo: 'corridos' | 'uteis';
  fDataLimite: string;
}

/**
 * EditWorkflowModal's form below 768px: the same fields and actions as the desktop
 * body, as grouped rows (pickers open sheets instead of popover selects). The dialog
 * around it, its unsaved-changes guard and the delete confirm stay EditWorkflowModal's.
 */
function EditWorkflowPhoneBody({
  card,
  membros,
  activeClientes,
  modoPrazo,
  isDirty,
  saving,
  showPlataformas,
  onChange,
  onMigrate,
  onOpenPosts,
  onSave,
  onDelete,
  ...f
}: EditWorkflowFields & {
  card: BoardCard;
  membros: Membro[];
  activeClientes: Cliente[];
  modoPrazo: ModoPrazo;
  isDirty: boolean;
  saving: boolean;
  showPlataformas: boolean;
  onChange: (patch: Partial<EditWorkflowFields>) => void;
  onMigrate: () => void;
  onOpenPosts?: () => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation('workflows');
  const intlLocale = useIntlLocale();
  const e = card.etapa;
  const memberOptions = [...membros]
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    .map((m) => ({ value: String(m.id), label: m.nome }));
  const deadlineNote =
    modoPrazo === 'data_entrega' && e.data_limite
      ? t('editWorkflowModal.deliveryNote', {
          date: new Date(e.data_limite + 'T00:00:00').toLocaleDateString(intlLocale),
        })
      : modoPrazo === 'data_fixa'
        ? t('shared.fixedDate')
        : undefined;

  return (
    <div className="phone-edit-wf">
      <GroupedList
        aria-label={t('editWorkflowModal.actionsAria')}
        footer={isDirty ? t('shared.saveBeforeMigrate') : undefined}
      >
        {onOpenPosts && (
          <Cell label={t('shared.posts')} icon={<FileText />} onClick={onOpenPosts} />
        )}
        <Cell
          label={t('shared.migrateTemplate')}
          icon={<ArrowRightLeft />}
          disabled={isDirty}
          onClick={onMigrate}
        />
      </GroupedList>

      <GroupedList header={t('editWorkflowModal.groupWorkflow')} headerAs="h3">
        <FormRow
          label={t('shared.titleRequiredLabel')}
          input={{ value: f.fTitulo, onChange: (ev) => onChange({ fTitulo: ev.target.value }) }}
        />
        <PickerCell
          label={t('shared.clientRequiredLabel')}
          searchable
          options={activeClientes.map((c) => ({ value: String(c.id), label: c.nome }))}
          value={f.fClienteId || null}
          onChange={(v) => {
            if (v) onChange({ fClienteId: v });
          }}
        />
        <Cell
          label={t('shared.recurringWorkflow')}
          switch={{
            checked: f.fRecorrente,
            onCheckedChange: (v) => onChange({ fRecorrente: v }),
          }}
        />
      </GroupedList>

      {showPlataformas && (
        <GroupedList
          header={t('shared.platforms')}
          headerAs="h3"
          footer={t('shared.platformsHint')}
        >
          <li className="phone-cell phone-edit-wf__chips">
            <PlatformChips value={f.fPlataformas} onChange={(v) => onChange({ fPlataformas: v })} />
          </li>
        </GroupedList>
      )}

      <GroupedList
        header={t('editWorkflowModal.currentStagePhone', { name: e.nome })}
        headerAs="h3"
        footer={deadlineNote}
      >
        <PickerCell
          label={t('shared.assignee')}
          options={memberOptions}
          emptyOption={{ label: t('shared.noAssignee') }}
          value={f.fResponsavelId || null}
          onChange={(v) => onChange({ fResponsavelId: v ?? '' })}
        />
        {modoPrazo === 'padrao' && (
          <>
            <FormRow
              label={t('shared.deadlineDays')}
              input={{
                type: 'number',
                min: 1,
                inputMode: 'numeric',
                value: f.fPrazoDias,
                onChange: (ev) => onChange({ fPrazoDias: ev.target.value }),
              }}
            />
            <PickerCell
              label={t('shared.deadlineType')}
              options={[
                { value: 'corridos', label: t('shared.calendarDays') },
                { value: 'uteis', label: t('shared.businessDays') },
              ]}
              value={f.fTipoPrazo}
              onChange={(v) => {
                if (v) onChange({ fTipoPrazo: v });
              }}
            />
          </>
        )}
        {modoPrazo === 'data_fixa' && (
          <FormRow
            label={t('shared.dueDate')}
            input={{
              type: 'date',
              value: f.fDataLimite,
              onChange: (ev) => onChange({ fDataLimite: ev.target.value }),
            }}
          />
        )}
      </GroupedList>

      <Button className="phone-edit-wf__save" onClick={onSave} disabled={saving}>
        {saving && <Spinner size="sm" />} {t('actions.save')}
      </Button>
      <GroupedList aria-label={t('editWorkflowModal.deleteWorkflow')}>
        <Cell
          label={t('editWorkflowModal.deleteWorkflow')}
          icon={<Trash2 />}
          destructive
          onClick={onDelete}
        />
      </GroupedList>
    </div>
  );
}

// ---- Templates Modal ----
export function TemplatesModal({
  open,
  onClose,
  templates,
  membros,
  onRefresh,
}: {
  open: boolean;
  onClose: () => void;
  templates: WorkflowTemplate[];
  membros: Membro[];
  onRefresh: () => void;
}) {
  const { t } = useTranslation('workflows');
  const [etapas, setEtapas] = useState<EtapaFormData[]>([defaultEtapa()]);
  const [saving, setSaving] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<WorkflowTemplate | null>(null);
  const [deleteTemplateId, setDeleteTemplateId] = useState<number | null>(null);
  const [fNome, setFNome] = useState('');
  const [fModoPrazo, setFModoPrazo] = useState<ModoPrazo>('padrao');
  const [fPlataformas, setFPlataformas] = useState<PlatformId[]>(['instagram']);
  const showPlataformas = usePlatformChipsVisible(fPlataformas);
  const formTopRef = useRef<HTMLDivElement>(null);

  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<'templates' | 'properties'>('templates');
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [showDefPanel, setShowDefPanel] = useState(false);
  const [editingDef, setEditingDef] = useState<TemplatePropertyDefinition | undefined>(undefined);
  const [deletingDefId, setDeletingDefId] = useState<number | null>(null);

  const { data: propertyDefinitions = [] } = useQuery({
    queryKey: ['property-definitions', selectedTemplateId],
    queryFn: () => getPropertyDefinitions(selectedTemplateId!),
    enabled: !!selectedTemplateId,
  });

  const handleDeleteDefinition = async () => {
    if (!deletingDefId) return;
    try {
      await deletePropertyDefinition(deletingDefId);
      toast.success(t('templatesModal.propertyDeleted'));
      qc.invalidateQueries({ queryKey: ['property-definitions', selectedTemplateId] });
    } catch {
      toast.error(t('templatesModal.propertyDeleteError'));
    }
    setDeletingDefId(null);
  };

  const handleSave = async () => {
    const nome = fNome.trim();
    if (!nome) {
      toast.error(t('templatesModal.nameRequired'));
      return;
    }
    const validEtapas = etapas.filter((e) => e.nome.trim());
    if (validEtapas.length === 0) {
      toast.error(t('templatesModal.addOneStage'));
      return;
    }
    // apply_post_process rejeita prazo_dias > 999 (template_invalid) na hora de
    // aplicar o template a um post; barrar aqui evita salvar um template que
    // nunca vai aplicar.
    if (findInvalidPrazoEtapa(validEtapas)) {
      toast.error(t('shared.deadlineMax', { max: MAX_PRAZO_DIAS }));
      return;
    }
    setSaving(true);
    try {
      const etapaData = validEtapas.map((e) => ({
        nome: e.nome,
        prazo_dias: e.prazo,
        tipo_prazo: e.tipoPrazo,
        responsavel_id: e.responsavelId,
        tipo: e.tipo,
      }));
      if (editingTemplate?.id) {
        await saveWorkflowTemplate(editingTemplate.id, {
          nome,
          etapas: etapaData,
          modo_prazo: fModoPrazo,
          plataformas: fPlataformas,
        });
        toast.success(t('templatesModal.updated'));
      } else {
        await addWorkflowTemplate({
          nome,
          etapas: etapaData,
          modo_prazo: fModoPrazo,
          plataformas: fPlataformas,
        });
        toast.success(t('templatesModal.created'));
      }
      setFNome('');
      setEtapas([defaultEtapa()]);
      setEditingTemplate(null);
      setFModoPrazo('padrao');
      setFPlataformas(['instagram']);
      onRefresh();
    } catch (err: unknown) {
      toast.error(saveErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (tpl: WorkflowTemplate) => {
    setEditingTemplate(tpl);
    setFNome(tpl.nome);
    setFModoPrazo((tpl.modo_prazo as ModoPrazo) || 'padrao');
    setFPlataformas(tpl.plataformas ?? ['instagram']);
    setEtapas(
      tpl.etapas.map((e) =>
        defaultEtapa({
          nome: e.nome,
          prazo: Math.max(0, Math.min(MAX_PRAZO_DIAS, Math.trunc(Number(e.prazo_dias)) || 0)),
          tipoPrazo: e.tipo_prazo,
          responsavelId: e.responsavel_id || null,
          tipo: e.tipo || 'padrao',
        }),
      ),
    );
    formTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleDeleteConfirm = async () => {
    if (deleteTemplateId == null) return;
    try {
      await removeWorkflowTemplate(deleteTemplateId);
      toast.success(t('templatesModal.deleted'));
      onRefresh();
    } catch {
      toast.error(t('templatesModal.deleteError'));
    }
    setDeleteTemplateId(null);
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(open) => {
          if (!open) {
            setFNome('');
            setEtapas([defaultEtapa()]);
            setEditingTemplate(null);
            setFModoPrazo('padrao');
            setFPlataformas(['instagram']);
            onClose();
          }
        }}
      >
        <DialogContent
          style={{ maxWidth: 700, width: 'calc(100vw - 2rem)' }}
          onConfirmClose={() => {
            setFNome('');
            setEtapas([defaultEtapa()]);
            setEditingTemplate(null);
            setFModoPrazo('padrao');
            setFPlataformas(['instagram']);
            onClose();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('templatesModal.title')}</DialogTitle>
          </DialogHeader>
          {/* Tab navigation */}
          <div
            style={{
              display: 'flex',
              gap: 0,
              borderBottom: '1px solid var(--border-color)',
              marginBottom: '1rem',
            }}
          >
            <button
              onClick={() => setActiveTab('templates')}
              style={{
                padding: '8px 16px',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                fontSize: '0.9rem',
                borderBottom:
                  activeTab === 'templates'
                    ? '2px solid var(--primary, #1d4ed8)'
                    : '2px solid transparent',
                color: activeTab === 'templates' ? 'var(--primary, #1d4ed8)' : 'inherit',
                fontWeight: activeTab === 'templates' ? 600 : 400,
                marginBottom: -1,
              }}
            >
              {t('templatesModal.tabTemplates')}
            </button>
            <button
              onClick={() => setActiveTab('properties')}
              style={{
                padding: '8px 16px',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                fontSize: '0.9rem',
                borderBottom:
                  activeTab === 'properties'
                    ? '2px solid var(--primary, #1d4ed8)'
                    : '2px solid transparent',
                color: activeTab === 'properties' ? 'var(--primary, #1d4ed8)' : 'inherit',
                fontWeight: activeTab === 'properties' ? 600 : 400,
                marginBottom: -1,
              }}
            >
              <Settings className="h-3.5 w-3.5" style={{ display: 'inline', marginRight: 4 }} />
              {t('templatesModal.tabProperties')}
            </button>
          </div>
          {activeTab === 'templates' && (
            <>
              <div ref={formTopRef} style={{ marginBottom: '1rem' }}>
                <h4 style={{ marginBottom: '0.75rem' }}>
                  {editingTemplate
                    ? t('templatesModal.editing', { name: editingTemplate.nome })
                    : t('templatesModal.newTemplate')}
                </h4>
                <div className="space-y-1" style={{ marginBottom: '0.75rem' }}>
                  <Label>{t('templatesModal.nameLabel')}</Label>
                  <Input
                    placeholder={t('templatesModal.namePlaceholder')}
                    value={fNome}
                    onChange={(e) => setFNome(e.target.value)}
                  />
                </div>
                <div className="space-y-1" style={{ marginBottom: '0.75rem' }}>
                  <Label>{t('templatesModal.deadlineMode')}</Label>
                  <Select value={fModoPrazo} onValueChange={(v) => setFModoPrazo(v as ModoPrazo)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="padrao">{t('shared.modePadrao')}</SelectItem>
                      <SelectItem value="data_fixa">{t('shared.modeDataFixa')}</SelectItem>
                      <SelectItem value="data_entrega">{t('shared.modeDataEntrega')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {showPlataformas && (
                  <div className="space-y-1" style={{ marginBottom: '0.75rem' }}>
                    <Label>{t('shared.platforms')}</Label>
                    <PlatformChips value={fPlataformas} onChange={setFPlataformas} />
                  </div>
                )}
                <SortableEtapaList
                  etapas={etapas}
                  setEtapas={setEtapas}
                  modoPrazo={fModoPrazo}
                  membros={membros}
                />
              </div>
              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
                {templates.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)' }}>{t('templatesModal.empty')}</p>
                ) : (
                  templates.map((tpl) => (
                    <div
                      key={tpl.id}
                      className="card"
                      style={{
                        marginBottom: '0.75rem',
                        padding: '1rem 1.25rem',
                        position: 'relative',
                      }}
                    >
                      <strong>{tpl.nome}</strong>
                      <p
                        style={{
                          fontSize: '0.82rem',
                          color: 'var(--text-muted)',
                          marginTop: '0.25rem',
                        }}
                      >
                        {t('templatesModal.stagesSummary', {
                          count: tpl.etapas.length,
                          names: tpl.etapas.map((e) => e.nome).join(' → '),
                        })}
                      </p>
                      <div
                        style={{
                          position: 'absolute',
                          top: '1rem',
                          right: '1rem',
                          display: 'flex',
                          gap: '0.5rem',
                        }}
                      >
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={t('templatesModal.editTemplateAria', { name: tpl.nome })}
                          onClick={() => handleEdit(tpl)}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => setDeleteTemplateId(tpl.id!)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
          {activeTab === 'properties' && (
            <div>
              {/* Template selector for properties tab */}
              <div style={{ marginBottom: '1rem' }}>
                <Label style={{ fontSize: '0.8rem' }}>{t('templatesModal.selectTemplate')}</Label>
                <select
                  className="drawer-select"
                  style={{ marginTop: 4, width: '100%' }}
                  value={selectedTemplateId ?? ''}
                  onChange={(e) =>
                    setSelectedTemplateId(e.target.value ? Number(e.target.value) : null)
                  }
                >
                  <option value="">{t('templatesModal.chooseTemplate')}</option>
                  {templates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.nome}
                    </option>
                  ))}
                </select>
              </div>

              {selectedTemplateId && (
                <>
                  {propertyDefinitions.length === 0 ? (
                    <p
                      style={{
                        color: 'var(--text-muted)',
                        fontSize: '0.85rem',
                        marginBottom: '0.75rem',
                      }}
                    >
                      {t('templatesModal.noProperties')}
                    </p>
                  ) : (
                    <div style={{ marginBottom: '0.75rem' }}>
                      {propertyDefinitions.map((def) => (
                        <div
                          key={def.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '7px 10px',
                            background: 'var(--card-bg-secondary, #f8fafc)',
                            border: '1px solid var(--border-color)',
                            borderRadius: 6,
                            marginBottom: 4,
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              fontSize: '0.85rem',
                            }}
                          >
                            <span
                              style={{
                                background: 'var(--primary-light, #eff6ff)',
                                color: 'var(--primary, #1d4ed8)',
                                padding: '1px 6px',
                                borderRadius: 4,
                                fontSize: '0.72rem',
                                fontWeight: 600,
                              }}
                            >
                              {def.type}
                            </span>
                            <span style={{ fontWeight: 500 }}>{def.name}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {def.portal_visible && (
                              <span
                                style={{
                                  background: '#dcfce7',
                                  color: '#15803d',
                                  padding: '1px 8px',
                                  borderRadius: 10,
                                  fontSize: '0.72rem',
                                }}
                              >
                                {t('templatesModal.portal')}
                              </span>
                            )}
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => {
                                setEditingDef(def);
                                setShowDefPanel(true);
                              }}
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-destructive"
                              onClick={() => setDeletingDefId(def.id!)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <Button
                    variant="outline"
                    size="sm"
                    style={{ borderStyle: 'dashed' }}
                    onClick={() => {
                      setEditingDef(undefined);
                      setShowDefPanel(true);
                    }}
                  >
                    {t('templatesModal.addProperty')}
                  </Button>
                </>
              )}

              {showDefPanel && selectedTemplateId && (
                <PropertyDefinitionPanel
                  templateId={selectedTemplateId}
                  definition={editingDef}
                  onSave={() => {
                    setShowDefPanel(false);
                    setEditingDef(undefined);
                    qc.invalidateQueries({
                      queryKey: ['property-definitions', selectedTemplateId],
                    });
                  }}
                  onClose={() => {
                    setShowDefPanel(false);
                    setEditingDef(undefined);
                  }}
                />
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setFNome('');
                setEtapas([defaultEtapa()]);
                setEditingTemplate(null);
                setFModoPrazo('padrao');
                setFPlataformas(['instagram']);
                onClose();
              }}
            >
              {t('actions.close')}
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Spinner size="sm" />}{' '}
              {editingTemplate ? t('actions.save') : t('templatesModal.saveTemplate')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={deleteTemplateId != null}
        onOpenChange={(open) => {
          if (!open) setDeleteTemplateId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('templatesModal.removeTitle')}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.no')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>{t('actions.yes')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={deletingDefId !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingDefId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('templatesModal.deletePropertyTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('templatesModal.deletePropertyDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteDefinition}
              className="bg-destructive text-destructive-foreground"
            >
              {t('shared.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// RecurringWorkflowDialog — shown when a recurring workflow completes
interface RecurringWorkflowDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}
export function RecurringWorkflowDialog({
  open,
  onConfirm,
  onCancel,
}: RecurringWorkflowDialogProps) {
  const { t } = useTranslation('workflows');
  const isPhone = !useIsDesktop(768);
  if (isPhone) {
    return (
      <PhoneConfirmSheet
        open={open}
        title={t('recurringDialog.title')}
        message={t('recurringDialog.message')}
        actions={[{ label: t('recurringDialog.confirm'), onSelect: onConfirm }]}
        cancelLabel={t('actions.no')}
        onCancel={onCancel}
      />
    );
  }
  return (
    <AlertDialog
      open={open}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('recurringDialog.title')}</AlertDialogTitle>
          <AlertDialogDescription>{t('recurringDialog.message')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>{t('actions.no')}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{t('recurringDialog.confirm')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// RevertConfirmDialog — shown when a card is dragged backward in kanban
interface RevertConfirmDialogProps {
  open: boolean;
  entityTitle: string;
  onConfirm: () => void;
  onCancel: () => void;
}
export function RevertConfirmDialog({
  open,
  entityTitle,
  onConfirm,
  onCancel,
}: RevertConfirmDialogProps) {
  const { t } = useTranslation('workflows');
  const isPhone = !useIsDesktop(768);
  if (isPhone) {
    return (
      <PhoneConfirmSheet
        open={open}
        title={t('revertDialog.title')}
        message={t('revertDialog.message', { title: entityTitle })}
        actions={[{ label: t('revertDialog.confirm'), onSelect: onConfirm }]}
        onCancel={onCancel}
      />
    );
  }
  return (
    <AlertDialog
      open={open}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('revertDialog.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('revertDialog.message', { title: entityTitle })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>{t('actions.cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{t('revertDialog.confirm')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ForwardConfirmDialog — shown when advancing a card to the next etapa
interface ForwardConfirmDialogProps {
  open: boolean;
  entityTitle: string;
  nextEtapaName: string;
  onConfirm: () => void;
  onCancel: () => void;
}
export function ForwardConfirmDialog({
  open,
  entityTitle,
  nextEtapaName,
  onConfirm,
  onCancel,
}: ForwardConfirmDialogProps) {
  const { t } = useTranslation('workflows');
  const isPhone = !useIsDesktop(768);
  if (isPhone) {
    return (
      <PhoneConfirmSheet
        open={open}
        title={t('forwardDialog.title')}
        message={t('forwardDialog.message', { title: entityTitle, next: nextEtapaName })}
        actions={[{ label: t('forwardDialog.confirm'), onSelect: onConfirm }]}
        onCancel={onCancel}
      />
    );
  }
  return (
    <AlertDialog
      open={open}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('forwardDialog.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('forwardDialog.message', { title: entityTitle, next: nextEtapaName })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>{t('actions.cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{t('forwardDialog.confirm')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
