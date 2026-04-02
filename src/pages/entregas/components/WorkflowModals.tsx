import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, Edit2, FileText, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Spinner } from '@/components/ui/spinner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import {
  getDeadlineInfo,
  addWorkflow, addWorkflowEtapa, addWorkflowTemplate, removeWorkflowTemplate,
  removeWorkflow,
  updateWorkflow, updateWorkflowEtapa, updateWorkflowTemplate,
  getPropertyDefinitions, deletePropertyDefinition,
  type Workflow, type WorkflowEtapa, type WorkflowTemplate, type Cliente, type Membro,
  type TemplatePropertyDefinition,
} from '../../../store';
import { PropertyDefinitionPanel } from './PropertyDefinitionPanel';

// ---- Types ----
interface BoardCard {
  workflow: Workflow;
  etapa: WorkflowEtapa;
  cliente: Cliente | undefined;
  membro: Membro | undefined;
  deadline: ReturnType<typeof getDeadlineInfo>;
  totalEtapas: number;
  etapaIdx: number;
}

interface EtapaFormData {
  nome: string;
  prazo: number;
  tipoPrazo: 'corridos' | 'uteis';
  responsavelId: number | null;
  tipo: 'padrao' | 'aprovacao_cliente';
}

function defaultEtapa(): EtapaFormData {
  return { nome: '', prazo: 3, tipoPrazo: 'corridos', responsavelId: null, tipo: 'padrao' };
}

// ---- EtapaRow component ----
function EtapaRow({
  index,
  nome,
  prazo,
  tipoPrazo,
  responsavelId,
  tipo,
  membros,
  onChange,
  onRemove,
}: {
  index: number;
  nome: string;
  prazo: number;
  tipoPrazo: string;
  responsavelId: number | null;
  tipo: 'padrao' | 'aprovacao_cliente';
  membros: Membro[];
  onChange: (field: string, val: unknown) => void;
  onRemove: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.75rem', padding: '0.75rem', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
      <Input
        placeholder="Nome da etapa"
        value={nome}
        onChange={e => onChange('nome', e.target.value)}
      />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
        <Input
          type="number"
          min={1}
          value={prazo}
          onChange={e => onChange('prazo', Number(e.target.value))}
          placeholder="Prazo"
        />
        <Select value={tipoPrazo} onValueChange={val => onChange('tipoPrazo', val)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="corridos">Corridos</SelectItem>
            <SelectItem value="uteis">Úteis</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Select value={responsavelId != null ? String(responsavelId) : '__none__'} onValueChange={val => onChange('responsavelId', val === '__none__' ? null : Number(val))}>
        <SelectTrigger><SelectValue placeholder="Sem responsável" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">Sem responsável</SelectItem>
          {membros.map(m => <SelectItem key={m.id} value={String(m.id)}>{m.nome}</SelectItem>)}
        </SelectContent>
      </Select>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <Button
          size="sm"
          variant={tipo === 'aprovacao_cliente' ? 'default' : 'outline'}
          title={tipo === 'aprovacao_cliente' ? 'Etapa de aprovação do cliente' : 'Marcar como aprovação do cliente'}
          onClick={() => onChange('tipo', tipo === 'aprovacao_cliente' ? 'padrao' : 'aprovacao_cliente')}
          style={{ fontSize: '0.7rem', padding: '0.25rem 0.5rem', whiteSpace: 'nowrap', flex: 1 }}
        >
          {tipo === 'aprovacao_cliente' ? '✓ Aprovação' : 'Aprovação'}
        </Button>
        <Button size="icon" variant="ghost" className="text-destructive" onClick={onRemove}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ---- New Workflow Modal ----
export function NewWorkflowModal({
  open,
  onClose,
  clientes,
  membros,
  templates,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  clientes: Cliente[];
  membros: Membro[];
  templates: WorkflowTemplate[];
  onCreated: () => void;
}) {
  const [etapas, setEtapas] = useState<EtapaFormData[]>([defaultEtapa()]);
  const [saving, setSaving] = useState(false);
  const [fTitulo, setFTitulo] = useState('');
  const [fClienteId, setFClienteId] = useState('');
  const [fTemplateId, setFTemplateId] = useState('');
  const [fNotion, setFNotion] = useState('');
  const [fDrive, setFDrive] = useState('');
  const [fRecorrente, setFRecorrente] = useState(false);

  const handleTemplateChange = (templateId: string) => {
    setFTemplateId(templateId);
    if (!templateId) return;
    const tpl = templates.find(t => t.id === Number(templateId));
    if (!tpl) return;
    setEtapas(tpl.etapas.map(e => ({
      nome: e.nome,
      prazo: e.prazo_dias,
      tipoPrazo: e.tipo_prazo,
      responsavelId: e.responsavel_id || null,
      tipo: (e as any).tipo || 'padrao',
    })));
  };

  const handleSave = async () => {
    if (!fTitulo || !fClienteId) { toast.error('Título e cliente são obrigatórios.'); return; }
    const validEtapas = etapas.filter(e => e.nome.trim());
    if (validEtapas.length === 0) { toast.error('Adicione pelo menos uma etapa.'); return; }
    setSaving(true);
    let wf: Workflow | null = null;
    try {
      wf = await addWorkflow({
        cliente_id: Number(fClienteId),
        titulo: fTitulo,
        template_id: fTemplateId ? Number(fTemplateId) : null,
        status: 'ativo',
        etapa_atual: 0,
        recorrente: fRecorrente,
        link_notion: fNotion.trim() || null,
        link_drive: fDrive.trim() || null,
      });
      const now = new Date().toISOString();
      for (let i = 0; i < validEtapas.length; i++) {
        const e = validEtapas[i];
        await addWorkflowEtapa({
          workflow_id: wf.id!,
          ordem: i,
          nome: e.nome,
          prazo_dias: e.prazo,
          tipo_prazo: e.tipoPrazo,
          tipo: e.tipo,
          responsavel_id: e.responsavelId,
          status: i === 0 ? 'ativo' : 'pendente',
          iniciado_em: i === 0 ? now : null,
          concluido_em: null,
        });
      }
      toast.success('Fluxo criado com sucesso!');
      setFTitulo(''); setFClienteId(''); setFTemplateId(''); setFNotion(''); setFDrive(''); setFRecorrente(false);
      setEtapas([defaultEtapa()]);
      onCreated();
      onClose();
    } catch (err: unknown) {
      if (wf?.id) try { await removeWorkflow(wf.id); } catch { /* */ }
      toast.error((err as Error).message || 'Erro ao criar fluxo');
    } finally {
      setSaving(false);
    }
  };

  const activeClientes = clientes.filter(c => c.status === 'ativo');

  return (
    <Dialog open={open} onOpenChange={open => { if (!open) { setEtapas([defaultEtapa()]); onClose(); } }}>
      <DialogContent style={{ maxWidth: 700, maxHeight: '90vh', overflowY: 'auto', width: 'calc(100vw - 2rem)' }} onConfirmClose={() => { setEtapas([defaultEtapa()]); onClose(); }}>
        <DialogHeader><DialogTitle>Novo Fluxo de Entrega</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label>Título *</Label><Input placeholder="Ex: Posts Instagram — Março 2026" value={fTitulo} onChange={e => setFTitulo(e.target.value)} /></div>
          <div className="space-y-1">
            <Label>Cliente *</Label>
            <Select value={fClienteId} onValueChange={setFClienteId}>
              <SelectTrigger><SelectValue placeholder="Selecionar cliente..." /></SelectTrigger>
              <SelectContent>
                {activeClientes.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Template</Label>
            <Select value={fTemplateId || '__none__'} onValueChange={val => handleTemplateChange(val === '__none__' ? '' : val)}>
              <SelectTrigger><SelectValue placeholder="Personalizado" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Personalizado</SelectItem>
                {templates.map(t => <SelectItem key={t.id} value={String(t.id)}>{t.nome} ({t.etapas.length} etapas)</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Link do Notion</Label><Input type="url" placeholder="https://notion.so/..." value={fNotion} onChange={e => setFNotion(e.target.value)} /></div>
          <div className="space-y-1"><Label>Link do Drive</Label><Input type="url" placeholder="https://drive.google.com/..." value={fDrive} onChange={e => setFDrive(e.target.value)} /></div>
          <div className="flex items-center gap-2">
            <Checkbox id="recorrente-new" checked={fRecorrente} onCheckedChange={v => setFRecorrente(!!v)} />
            <Label htmlFor="recorrente-new">Fluxo recorrente (ao concluir, oferecer criar novo ciclo)</Label>
          </div>
          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem', marginTop: '0.5rem' }}>
            <h4 style={{ marginBottom: '0.75rem' }}>Etapas</h4>
            {etapas.map((e, i) => (
              <EtapaRow
                key={i}
                index={i}
                nome={e.nome}
                prazo={e.prazo}
                tipoPrazo={e.tipoPrazo}
                responsavelId={e.responsavelId}
                tipo={e.tipo}
                membros={membros}
                onChange={(field, val) => {
                  const next = [...etapas];
                  (next[i] as unknown as Record<string, unknown>)[field] = val;
                  setEtapas(next);
                }}
                onRemove={() => setEtapas(etapas.filter((_, idx) => idx !== i))}
              />
            ))}
            <Button size="sm" variant="outline" onClick={() => setEtapas([...etapas, defaultEtapa()])}>
              <Plus className="h-3 w-3" /> Adicionar Etapa
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setEtapas([defaultEtapa()]); onClose(); }}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>{saving && <Spinner size="sm" />} Criar Fluxo</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Edit Workflow Modal ----
export function EditWorkflowModal({
  card,
  membros,
  clientes,
  onClose,
  onSaved,
  onDeleted,
  onOpenPosts,
}: {
  card: BoardCard;
  membros: Membro[];
  clientes: Cliente[];
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
  onOpenPosts?: () => void;
}) {
  const w = card.workflow;
  const e = card.etapa;
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [fTitulo, setFTitulo] = useState(w.titulo);
  const [fClienteId, setFClienteId] = useState(String(w.cliente_id));
  const [fNotion, setFNotion] = useState(w.link_notion || '');
  const [fDrive, setFDrive] = useState(w.link_drive || '');
  const [fRecorrente, setFRecorrente] = useState(w.recorrente || false);
  const [fResponsavelId, setFResponsavelId] = useState(String(e.responsavel_id || ''));
  const [fPrazoDias, setFPrazoDias] = useState(String(e.prazo_dias));
  const [fTipoPrazo, setFTipoPrazo] = useState(e.tipo_prazo);
  const activeClientes = clientes.filter(c => c.status === 'ativo');

  const handleSave = async () => {
    if (!fTitulo || !fClienteId) { toast.error('Título e cliente são obrigatórios.'); return; }
    setSaving(true);
    try {
      await updateWorkflow(w.id!, {
        titulo: fTitulo,
        cliente_id: Number(fClienteId),
        recorrente: fRecorrente,
        link_notion: fNotion.trim() || null,
        link_drive: fDrive.trim() || null,
      });
      await updateWorkflowEtapa(e.id!, {
        responsavel_id: fResponsavelId ? Number(fResponsavelId) : null,
        prazo_dias: Number(fPrazoDias) || e.prazo_dias,
        tipo_prazo: fTipoPrazo as 'corridos' | 'uteis',
      });
      toast.success('Fluxo atualizado!');
      onSaved();
      onClose();
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erro');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      await removeWorkflow(w.id!);
      toast.success('Fluxo excluído!');
      onDeleted();
      onClose();
    } catch { toast.error('Erro ao excluir'); }
  };

  return (
    <>
      <Dialog open={true} onOpenChange={open => { if (!open) onClose(); }}>
        <DialogContent onConfirmClose={onClose}>
          <DialogHeader><DialogTitle>Editar Fluxo</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label>Título *</Label><Input value={fTitulo} onChange={e => setFTitulo(e.target.value)} /></div>
            <div className="space-y-1">
              <Label>Cliente *</Label>
              <Select value={fClienteId} onValueChange={setFClienteId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {activeClientes.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="space-y-1"><Label>Link do Notion</Label><Input type="url" value={fNotion} onChange={e => setFNotion(e.target.value)} /></div>
              <div className="space-y-1"><Label>Link do Drive</Label><Input type="url" value={fDrive} onChange={e => setFDrive(e.target.value)} /></div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="recorrente-edit" checked={fRecorrente} onCheckedChange={v => setFRecorrente(!!v)} />
              <Label htmlFor="recorrente-edit">Fluxo recorrente</Label>
            </div>
            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
              <h4 style={{ marginBottom: '0.75rem' }}>Etapa Atual: {e.nome}</h4>
              <div className="space-y-1">
                <Label>Responsável</Label>
                <Select value={fResponsavelId || '__none__'} onValueChange={val => setFResponsavelId(val === '__none__' ? '' : val)}>
                  <SelectTrigger><SelectValue placeholder="Sem responsável" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Sem responsável</SelectItem>
                    {membros.map(m => <SelectItem key={m.id} value={String(m.id)}>{m.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '0.75rem' }}>
                <div className="space-y-1"><Label>Prazo (dias)</Label><Input type="number" min={1} value={fPrazoDias} onChange={e => setFPrazoDias(e.target.value)} /></div>
                <div className="space-y-1">
                  <Label>Tipo de prazo</Label>
                  <Select value={fTipoPrazo} onValueChange={v => setFTipoPrazo(v as 'corridos' | 'uteis')}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="corridos">Dias corridos</SelectItem>
                      <SelectItem value="uteis">Dias úteis</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>
          <div className="edit-modal-footer">
            <div className="edit-modal-footer-secondary">
              <Button variant="outline" className="text-destructive" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="h-4 w-4" /> Excluir
              </Button>
              {onOpenPosts && (
                <Button variant="outline" onClick={onOpenPosts}>
                  <FileText className="h-4 w-4" /> Posts
                </Button>
              )}
            </div>
            <div className="edit-modal-footer-primary">
              <Button variant="outline" onClick={onClose}>Cancelar</Button>
              <Button onClick={handleSave} disabled={saving}>{saving && <Spinner size="sm" />} Salvar</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir fluxo "{w.titulo}"?</AlertDialogTitle>
            <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
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
  const [etapas, setEtapas] = useState<EtapaFormData[]>([defaultEtapa()]);
  const [saving, setSaving] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<WorkflowTemplate | null>(null);
  const [deleteTemplateId, setDeleteTemplateId] = useState<number | null>(null);
  const [fNome, setFNome] = useState('');

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
      toast.success('Propriedade excluída.');
      qc.invalidateQueries({ queryKey: ['property-definitions', selectedTemplateId] });
    } catch { toast.error('Erro ao excluir propriedade.'); }
    setDeletingDefId(null);
  };

  const handleSave = async () => {
    const nome = fNome.trim();
    if (!nome) { toast.error('Nome do template é obrigatório.'); return; }
    const validEtapas = etapas.filter(e => e.nome.trim());
    if (validEtapas.length === 0) { toast.error('Adicione pelo menos uma etapa.'); return; }
    setSaving(true);
    try {
      const etapaData = validEtapas.map(e => ({
        nome: e.nome,
        prazo_dias: e.prazo,
        tipo_prazo: e.tipoPrazo,
        responsavel_id: e.responsavelId,
      }));
      if (editingTemplate?.id) {
        await updateWorkflowTemplate(editingTemplate.id, { nome, etapas: etapaData });
        toast.success('Template atualizado!');
      } else {
        await addWorkflowTemplate({ nome, etapas: etapaData });
        toast.success('Template criado!');
      }
      setFNome('');
      setEtapas([defaultEtapa()]);
      setEditingTemplate(null);
      onRefresh();
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erro');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (tpl: WorkflowTemplate) => {
    setEditingTemplate(tpl);
    setFNome(tpl.nome);
    setEtapas(tpl.etapas.map(e => ({
      nome: e.nome,
      prazo: e.prazo_dias,
      tipoPrazo: e.tipo_prazo,
      responsavelId: e.responsavel_id || null,
      tipo: (e as any).tipo || 'padrao',
    })));
  };

  const handleDeleteConfirm = async () => {
    if (deleteTemplateId == null) return;
    try {
      await removeWorkflowTemplate(deleteTemplateId);
      toast.success('Template excluído.');
      onRefresh();
    } catch { toast.error('Erro ao excluir.'); }
    setDeleteTemplateId(null);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={open => { if (!open) { setFNome(''); setEtapas([defaultEtapa()]); setEditingTemplate(null); onClose(); } }}>
        <DialogContent style={{ maxWidth: 700, maxHeight: '90vh', overflowY: 'auto', width: 'calc(100vw - 2rem)' }} onConfirmClose={() => { setFNome(''); setEtapas([defaultEtapa()]); setEditingTemplate(null); onClose(); }}>
          <DialogHeader><DialogTitle>Gerenciar Templates</DialogTitle></DialogHeader>
          {/* Tab navigation */}
          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border-color)', marginBottom: '1rem' }}>
            <button
              onClick={() => setActiveTab('templates')}
              style={{
                padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer', fontSize: '0.9rem',
                borderBottom: activeTab === 'templates' ? '2px solid var(--primary, #1d4ed8)' : '2px solid transparent',
                color: activeTab === 'templates' ? 'var(--primary, #1d4ed8)' : 'inherit',
                fontWeight: activeTab === 'templates' ? 600 : 400, marginBottom: -1,
              }}
            >
              Templates
            </button>
            <button
              onClick={() => setActiveTab('properties')}
              style={{
                padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer', fontSize: '0.9rem',
                borderBottom: activeTab === 'properties' ? '2px solid var(--primary, #1d4ed8)' : '2px solid transparent',
                color: activeTab === 'properties' ? 'var(--primary, #1d4ed8)' : 'inherit',
                fontWeight: activeTab === 'properties' ? 600 : 400, marginBottom: -1,
              }}
            >
              <Settings className="h-3.5 w-3.5" style={{ display: 'inline', marginRight: 4 }} />
              Propriedades
            </button>
          </div>
          {activeTab === 'templates' && (
            <>
              <div style={{ marginBottom: '1rem' }}>
                {templates.length === 0
                  ? <p style={{ color: 'var(--text-muted)' }}>Nenhum template salvo.</p>
                  : templates.map(t => (
                    <div key={t.id} className="card" style={{ marginBottom: '0.75rem', padding: '1rem 1.25rem', position: 'relative' }}>
                      <strong>{t.nome}</strong>
                      <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                        {t.etapas.length} etapa{t.etapas.length !== 1 ? 's' : ''}: {t.etapas.map(e => e.nome).join(' → ')}
                      </p>
                      <div style={{ position: 'absolute', top: '1rem', right: '1rem', display: 'flex', gap: '0.5rem' }}>
                        <Button size="icon" variant="ghost" onClick={() => handleEdit(t)}><Edit2 className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" className="text-destructive" onClick={() => setDeleteTemplateId(t.id!)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </div>
                  ))
                }
              </div>
              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
                <h4 style={{ marginBottom: '0.75rem' }}>{editingTemplate ? `Editar: ${editingTemplate.nome}` : 'Novo Template'}</h4>
                <div className="space-y-1" style={{ marginBottom: '0.75rem' }}>
                  <Label>Nome *</Label>
                  <Input placeholder="Ex: Fluxo Padrão de Post" value={fNome} onChange={e => setFNome(e.target.value)} />
                </div>
                {etapas.map((e, i) => (
                  <EtapaRow
                    key={i}
                    index={i}
                    nome={e.nome}
                    prazo={e.prazo}
                    tipoPrazo={e.tipoPrazo}
                    responsavelId={e.responsavelId}
                    tipo={e.tipo}
                    membros={membros}
                    onChange={(field, val) => {
                      const next = [...etapas];
                      (next[i] as unknown as Record<string, unknown>)[field] = val;
                      setEtapas(next);
                    }}
                    onRemove={() => setEtapas(etapas.filter((_, idx) => idx !== i))}
                  />
                ))}
                <Button size="sm" variant="outline" onClick={() => setEtapas([...etapas, defaultEtapa()])}>
                  <Plus className="h-3 w-3" /> Adicionar Etapa
                </Button>
              </div>
            </>
          )}
          {activeTab === 'properties' && (
            <div>
              {/* Template selector for properties tab */}
              <div style={{ marginBottom: '1rem' }}>
                <Label style={{ fontSize: '0.8rem' }}>Selecionar template</Label>
                <select
                  className="drawer-select"
                  style={{ marginTop: 4, width: '100%' }}
                  value={selectedTemplateId ?? ''}
                  onChange={e => setSelectedTemplateId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Escolha um template…</option>
                  {templates.map(t => (
                    <option key={t.id} value={t.id}>{t.nome}</option>
                  ))}
                </select>
              </div>

              {selectedTemplateId && (
                <>
                  {propertyDefinitions.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                      Nenhuma propriedade definida neste template.
                    </p>
                  ) : (
                    <div style={{ marginBottom: '0.75rem' }}>
                      {propertyDefinitions.map(def => (
                        <div
                          key={def.id}
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '7px 10px', background: 'var(--card-bg-secondary, #f8fafc)',
                            border: '1px solid var(--border-color)', borderRadius: 6, marginBottom: 4,
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem' }}>
                            <span style={{
                              background: 'var(--primary-light, #eff6ff)', color: 'var(--primary, #1d4ed8)',
                              padding: '1px 6px', borderRadius: 4, fontSize: '0.72rem', fontWeight: 600,
                            }}>
                              {def.type}
                            </span>
                            <span style={{ fontWeight: 500 }}>{def.name}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {def.portal_visible && (
                              <span style={{
                                background: '#dcfce7', color: '#15803d',
                                padding: '1px 8px', borderRadius: 10, fontSize: '0.72rem',
                              }}>
                                Portal
                              </span>
                            )}
                            <Button
                              size="icon" variant="ghost"
                              onClick={() => { setEditingDef(def); setShowDefPanel(true); }}
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon" variant="ghost" className="text-destructive"
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
                    variant="outline" size="sm"
                    style={{ borderStyle: 'dashed' }}
                    onClick={() => { setEditingDef(undefined); setShowDefPanel(true); }}
                  >
                    + Adicionar propriedade
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
                    qc.invalidateQueries({ queryKey: ['property-definitions', selectedTemplateId] });
                  }}
                  onClose={() => { setShowDefPanel(false); setEditingDef(undefined); }}
                />
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setFNome(''); setEtapas([defaultEtapa()]); setEditingTemplate(null); onClose(); }}>Fechar</Button>
            <Button onClick={handleSave} disabled={saving}>{saving && <Spinner size="sm" />} {editingTemplate ? 'Salvar' : 'Salvar Template'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={deleteTemplateId != null} onOpenChange={open => { if (!open) setDeleteTemplateId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Remover este template?</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Não</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>Sim</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={deletingDefId !== null} onOpenChange={open => { if (!open) setDeletingDefId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir propriedade?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso removerá os valores preenchidos em todos os posts deste template. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteDefinition} className="bg-destructive text-destructive-foreground">
              Excluir
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
export function RecurringWorkflowDialog({ open, onConfirm, onCancel }: RecurringWorkflowDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={open => { if (!open) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Criar novo ciclo?</AlertDialogTitle>
          <AlertDialogDescription>Este fluxo é recorrente. Deseja criar um novo ciclo?</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Não</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Criar novo ciclo</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// RevertConfirmDialog — shown when a card is dragged backward in kanban
interface RevertConfirmDialogProps {
  open: boolean;
  workflowTitle: string;
  onConfirm: () => void;
  onCancel: () => void;
}
export function RevertConfirmDialog({ open, workflowTitle, onConfirm, onCancel }: RevertConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={open => { if (!open) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reverter etapa?</AlertDialogTitle>
          <AlertDialogDescription>
            Isso vai reverter "{workflowTitle}" para a etapa anterior. Esta ação pode ser refeita arrastando para frente novamente.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Reverter</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
