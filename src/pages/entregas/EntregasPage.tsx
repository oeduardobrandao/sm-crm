import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, LayoutGrid, Trash2, Edit2, Info, Share2, ArrowLeft, Check, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Spinner } from '@/components/ui/spinner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import {
  getWorkflows, getClientes, getMembros, getWorkflowTemplates, getWorkflowEtapas,
  addWorkflow, addWorkflowEtapa, addWorkflowTemplate, removeWorkflowTemplate,
  completeEtapa, revertEtapa, duplicateWorkflow, removeWorkflow,
  updateWorkflow, updateWorkflowEtapa, updateWorkflowTemplate,
  getDeadlineInfo, getInitials, createPortalToken, getPortalApprovals, replyToPortalApproval,
  type Workflow, type WorkflowEtapa, type WorkflowTemplate, type Cliente, type Membro, type PortalApproval,
} from '../../store';
import { sanitizeUrl } from '../../utils/security';

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

interface BoardState {
  filterCliente: number | null;
  filterMembro: number | null;
  filterStatus: 'todos' | 'atrasado' | 'urgente' | 'em_dia';
}

// ---- Avatar ----
const avatarColors = ['#eab308', '#3ecf8e', '#f5a342', '#f542c8', '#42c8f5', '#8b5cf6', '#ef4444', '#14b8a6'];
function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return avatarColors[Math.abs(hash) % avatarColors.length];
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
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 110px 150px auto auto', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'center' }}>
      <Input
        placeholder="Nome da etapa"
        value={nome}
        onChange={e => onChange('nome', e.target.value)}
      />
      <Input
        type="number"
        min={1}
        value={prazo}
        onChange={e => onChange('prazo', Number(e.target.value))}
      />
      <Select value={tipoPrazo} onValueChange={val => onChange('tipoPrazo', val)}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="corridos">Corridos</SelectItem>
          <SelectItem value="uteis">Úteis</SelectItem>
        </SelectContent>
      </Select>
      <Select value={responsavelId != null ? String(responsavelId) : '__none__'} onValueChange={val => onChange('responsavelId', val === '__none__' ? null : Number(val))}>
        <SelectTrigger><SelectValue placeholder="Sem responsável" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">Sem responsável</SelectItem>
          {membros.map(m => <SelectItem key={m.id} value={String(m.id)}>{m.nome}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        variant={tipo === 'aprovacao_cliente' ? 'default' : 'outline'}
        title={tipo === 'aprovacao_cliente' ? 'Etapa de aprovação do cliente' : 'Marcar como aprovação do cliente'}
        onClick={() => onChange('tipo', tipo === 'aprovacao_cliente' ? 'padrao' : 'aprovacao_cliente')}
        style={{ fontSize: '0.7rem', padding: '0.25rem 0.5rem', whiteSpace: 'nowrap' }}
      >
        {tipo === 'aprovacao_cliente' ? '✓ Aprovação' : 'Aprovação'}
      </Button>
      <Button size="icon" variant="ghost" className="text-destructive" onClick={onRemove}>
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

// ---- New Workflow Modal ----
function NewWorkflowModal({
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
      <DialogContent style={{ maxWidth: 700, maxHeight: '90vh', overflowY: 'auto' }}>
        <DialogHeader><DialogTitle>Novo Fluxo de Entrega</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label>Título *</Label><Input placeholder="Ex: Posts Instagram — Março 2026" value={fTitulo} onChange={e => setFTitulo(e.target.value)} /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
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
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="space-y-1"><Label>Link do Notion</Label><Input type="url" placeholder="https://notion.so/..." value={fNotion} onChange={e => setFNotion(e.target.value)} /></div>
            <div className="space-y-1"><Label>Link do Drive</Label><Input type="url" placeholder="https://drive.google.com/..." value={fDrive} onChange={e => setFDrive(e.target.value)} /></div>
          </div>
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
function EditWorkflowModal({
  card,
  membros,
  clientes,
  onClose,
  onSaved,
  onDeleted,
}: {
  card: BoardCard;
  membros: Membro[];
  clientes: Cliente[];
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
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
        <DialogContent>
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
          <DialogFooter>
            <Button variant="ghost" className="text-destructive mr-auto" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="h-4 w-4" /> Excluir
            </Button>
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>{saving && <Spinner size="sm" />} Salvar</Button>
          </DialogFooter>
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
function TemplatesModal({
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
        <DialogContent style={{ maxWidth: 700, maxHeight: '90vh', overflowY: 'auto' }}>
          <DialogHeader><DialogTitle>Gerenciar Templates</DialogTitle></DialogHeader>
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
    </>
  );
}

// ---- Main Page ----
export default function EntregasPage() {
  const qc = useQueryClient();
  const [boardState, setBoardState] = useState<BoardState>({ filterCliente: null, filterMembro: null, filterStatus: 'todos' });
  const [newWorkflowOpen, setNewWorkflowOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [editCard, setEditCard] = useState<BoardCard | null>(null);
  const [assignDropdown, setAssignDropdown] = useState<{ etapaId: number } | null>(null);
  const [recurringWfId, setRecurringWfId] = useState<number | null>(null);
  const [revertWfId, setRevertWfId] = useState<number | null>(null);
  const [replyTexts, setReplyTexts] = useState<Record<number, string>>({});
  const [submittingReply, setSubmittingReply] = useState<number | null>(null);

  const handleReply = async (workflowId: number, etapaId: number) => {
    const text = replyTexts[etapaId];
    if (!text || !text.trim()) return;
    setSubmittingReply(etapaId);
    try {
      await replyToPortalApproval(workflowId, etapaId, text);
      setReplyTexts(prev => ({ ...prev, [etapaId]: '' }));
      qc.invalidateQueries({ queryKey: ['portal-approvals'] });
      toast.success('Resposta enviada com sucesso!');
    } catch (err: any) {
      toast.error('Erro ao enviar: ' + err.message);
    } finally {
      setSubmittingReply(null);
    }
  };

  const { data: workflows = [], isLoading: loadingWf } = useQuery({ queryKey: ['workflows'], queryFn: getWorkflows });
  const { data: clientes = [] } = useQuery({ queryKey: ['clientes'], queryFn: getClientes });
  const { data: membros = [] } = useQuery({ queryKey: ['membros'], queryFn: getMembros });
  const { data: templates = [] } = useQuery({ queryKey: ['workflow-templates'], queryFn: getWorkflowTemplates });

  const activeWorkflows = workflows.filter(w => w.status === 'ativo');

  const etapasQueries = useQuery({
    queryKey: ['all-active-etapas', activeWorkflows.map(w => w.id).join(',')],
    queryFn: async () => {
      const map = new Map<number, WorkflowEtapa[]>();
      await Promise.all(activeWorkflows.map(async w => {
        const etapas = await getWorkflowEtapas(w.id!);
        map.set(w.id!, etapas);
      }));
      return map;
    },
    enabled: !loadingWf,
  });

  const etapasMap: Map<number, WorkflowEtapa[]> = etapasQueries.data || new Map();

  // Collect approval-type active etapa IDs to fetch their comments
  const approvalEtapaIds: number[] = [];
  for (const [, etapas] of etapasMap) {
    for (const e of etapas) {
      if (e.tipo === 'aprovacao_cliente' && e.status === 'ativo' && e.id) {
        approvalEtapaIds.push(e.id);
      }
    }
  }

  const { data: portalApprovals = [] } = useQuery({
    queryKey: ['portal-approvals', approvalEtapaIds.join(',')],
    queryFn: () => getPortalApprovals(approvalEtapaIds),
    enabled: approvalEtapaIds.length > 0,
  });

  const approvalsMap = new Map<number, PortalApproval[]>();
  for (const a of portalApprovals) {
    const list = approvalsMap.get(a.workflow_etapa_id) || [];
    list.push(a);
    approvalsMap.set(a.workflow_etapa_id, list);
  }

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['workflows'] });
    qc.invalidateQueries({ queryKey: ['workflow-templates'] });
    qc.invalidateQueries({ queryKey: ['all-active-etapas'] });
    qc.invalidateQueries({ queryKey: ['portal-approvals'] });
  };

  // Build board cards
  let cards: BoardCard[] = [];
  for (const w of activeWorkflows) {
    const etapas = etapasMap.get(w.id!) || [];
    let activeEtapa = etapas.find(e => e.status === 'ativo');
    if (!activeEtapa && etapas.length > 0) {
      activeEtapa = etapas[w.etapa_atual] || etapas[0];
    }
    if (!activeEtapa) continue;
    const cliente = clientes.find(c => c.id === w.cliente_id);
    const membro = activeEtapa.responsavel_id ? membros.find(m => m.id === activeEtapa.responsavel_id) : undefined;
    const deadline = getDeadlineInfo(activeEtapa);
    cards.push({
      workflow: w,
      etapa: activeEtapa,
      cliente,
      membro,
      deadline,
      totalEtapas: etapas.length,
      etapaIdx: activeEtapa.ordem,
    });
  }

  if (boardState.filterCliente) cards = cards.filter(c => c.workflow.cliente_id === boardState.filterCliente);
  if (boardState.filterMembro) cards = cards.filter(c => c.etapa.responsavel_id === boardState.filterMembro);
  if (boardState.filterStatus === 'atrasado') cards = cards.filter(c => c.deadline.estourado);
  else if (boardState.filterStatus === 'urgente') cards = cards.filter(c => c.deadline.urgente);
  else if (boardState.filterStatus === 'em_dia') cards = cards.filter(c => !c.deadline.estourado && !c.deadline.urgente);

  interface BoardRow { key: string; label: string; stepNames: string[]; columns: Map<string, BoardCard[]>; }
  const rowMap = new Map<string, BoardRow>();
  for (const w of activeWorkflows) {
    const etapas = etapasMap.get(w.id!) || [];
    const stepNames = etapas.slice().sort((a, b) => a.ordem - b.ordem).map(e => e.nome);
    const key = stepNames.join(' → ');
    if (!rowMap.has(key)) {
      const tpl = w.template_id ? templates.find(t => t.id === w.template_id) : null;
      const label = tpl ? tpl.nome : key;
      const columns = new Map<string, BoardCard[]>();
      for (const name of stepNames) columns.set(name, []);
      rowMap.set(key, { key, label, stepNames, columns });
    }
  }

  for (const card of cards) {
    const etapas = etapasMap.get(card.workflow.id!) || [];
    const stepNames = etapas.slice().sort((a, b) => a.ordem - b.ordem).map(e => e.nome);
    const key = stepNames.join(' → ');
    const row = rowMap.get(key);
    if (row) {
      const col = row.columns.get(card.etapa.nome);
      if (col) col.push(card);
    }
  }

  const boardRows = [...rowMap.values()].filter(r => {
    for (const col of Array.from(r.columns.values())) if (col.length > 0) return true;
    return false;
  });

  const overdue = cards.filter(c => c.deadline.estourado).length;
  const urgent = cards.filter(c => c.deadline.urgente).length;
  const activeClientIds = new Set(activeWorkflows.map(w => w.cliente_id));
  const activeClients = clientes.filter(c => activeClientIds.has(c.id!));

  const handleCompleteEtapa = async (wid: number, eid: number) => {
    try {
      const result = await completeEtapa(wid, eid);
      if (result.workflow.status === 'concluido') {
        const wf = workflows.find(w => w.id === wid);
        if (wf?.recorrente) {
          setRecurringWfId(wid);
        } else {
          toast.success('Fluxo concluído!');
          refresh();
        }
      } else {
        toast.success('Etapa concluída! Próxima etapa ativada.');
        refresh();
      }
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erro');
    }
  };

  const handleRecurringConfirm = async () => {
    if (!recurringWfId) return;
    try {
      await duplicateWorkflow(recurringWfId);
      toast.success('Novo ciclo criado!');
    } catch { toast.error('Erro ao criar ciclo'); }
    setRecurringWfId(null);
    refresh();
  };

  const handleRevertExecute = async () => {
    if (!revertWfId) return;
    try {
      await revertEtapa(revertWfId);
      toast.success('Etapa revertida com sucesso.');
      refresh();
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erro');
    } finally {
      setRevertWfId(null);
    }
  };

  const handleAssignMember = async (etapaId: number, memberId: number | null) => {
    try {
      await updateWorkflowEtapa(etapaId, { responsavel_id: memberId });
      setAssignDropdown(null);
      refresh();
    } catch { toast.error('Erro ao atualizar responsável.'); }
  };

  if (loadingWf || etapasQueries.isLoading || (activeWorkflows.length > 0 && !etapasQueries.data)) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40vh' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <header className="header animate-up">
        <div className="header-title">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <h1>Entregas</h1>
            <span data-tooltip="Acompanhe o andamento das entregas e fluxos ativos." data-tooltip-dir="right" style={{ display: 'flex' }}>
              <Info className="h-5 w-5 cursor-pointer" style={{ color: 'var(--text-muted)' }} />
            </span>
          </div>
          <p>
            fluxos ativos: {activeWorkflows.length}
            {overdue > 0 && <span style={{ color: 'var(--danger)', fontWeight: 600 }}> • {overdue} atrasado{overdue > 1 ? 's' : ''}</span>}
            {urgent > 0 && <span style={{ color: 'var(--warning)', fontWeight: 600 }}> • {urgent} urgente{urgent > 1 ? 's' : ''}</span>}
          </p>
        </div>
        <div className="header-actions">
          <Button variant="outline" onClick={() => setTemplatesOpen(true)}><LayoutGrid className="h-4 w-4" style={{ marginRight: '0.5rem' }} /> Templates</Button>
          <Button onClick={() => setNewWorkflowOpen(true)}><Plus className="h-4 w-4" style={{ marginRight: '0.5rem' }} /> Novo Fluxo</Button>
        </div>
      </header>

      <div className="leads-toolbar animate-up">
        <div className="filter-bar" style={{ margin: 0 }}>
          {(['todos', 'atrasado', 'urgente', 'em_dia'] as const).map(s => (
            <button
              key={s}
              className={`filter-btn${boardState.filterStatus === s ? ' active' : ''}`}
              onClick={() => setBoardState(bs => ({ ...bs, filterStatus: s }))}
            >
              {s === 'todos' ? 'Todos' : s === 'atrasado' ? '🔴 Atrasados' : s === 'urgente' ? '🟡 Urgentes' : '🟢 Em dia'}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Select
            value={boardState.filterCliente ? String(boardState.filterCliente) : '__none__'}
            onValueChange={val => setBoardState(bs => ({ ...bs, filterCliente: val === '__none__' ? null : Number(val) }))}
          >
            <SelectTrigger style={{ minWidth: 180 }}><SelectValue placeholder="Todos os clientes" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Todos os clientes</SelectItem>
              {activeClients.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select
            value={boardState.filterMembro ? String(boardState.filterMembro) : '__none__'}
            onValueChange={val => setBoardState(bs => ({ ...bs, filterMembro: val === '__none__' ? null : Number(val) }))}
          >
            <SelectTrigger style={{ minWidth: 180 }}><SelectValue placeholder="Todos os membros" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Todos os membros</SelectItem>
              {membros.map(m => <SelectItem key={m.id} value={String(m.id)}>{m.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="board-rows-wrapper animate-up">
        {boardRows.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)', width: '100%' }}>
            <p>Nenhum fluxo ativo. Crie um novo fluxo para começar!</p>
          </div>
        ) : (
          boardRows.map(row => (
            <div key={row.key}>
              {boardRows.length > 1 && <div className="board-row-label" style={{ marginBottom: '1rem' }}>{row.label}</div>}
              <div className="board-container">
                {[...row.columns.entries()].map(([stepName, stepCards]) => (
                  <div key={stepName} className="board-column">
                    <div className="board-column-header">
                      <span className="board-column-title">{stepName}</span>
                      <span className="board-column-count">{stepCards.length}</span>
                    </div>
                    <div className="board-column-body">
                      {stepCards.length === 0
                        ? <div className="board-empty">Nenhuma entrega</div>
                        : stepCards.map(card => {
                          const dl = card.deadline;
                          const deadlineClass = dl.estourado ? 'deadline-overdue' : dl.urgente ? 'deadline-warning' : dl.diasRestantes <= 3 ? 'deadline-caution' : 'deadline-ok';
                          const deadlineText = dl.estourado ? `${Math.abs(dl.diasRestantes)}d atrasado` : dl.diasRestantes === 0 ? 'Vence hoje' : `${dl.diasRestantes}d restante${dl.diasRestantes > 1 ? 's' : ''}`;
                          const progressPct = card.totalEtapas > 0 ? Math.round((card.etapaIdx / card.totalEtapas) * 100) : 0;
                          const iniciadoEm = card.etapa.iniciado_em
                            ? new Date(card.etapa.iniciado_em).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
                            : null;

                          return (
                            <div key={card.workflow.id} className={`board-card ${deadlineClass}`}>
                              <div className="board-card-top">
                                <span className="board-card-client" style={{ borderLeft: `3px solid ${card.cliente?.cor || '#888'}`, paddingLeft: '0.5rem' }}>
                                  {card.cliente?.nome || '—'}
                                </span>
                                {card.workflow.recorrente && <span title="Recorrente" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>↻</span>}
                              </div>
                              <div className="board-card-title">{card.workflow.titulo}</div>
                              <div className="board-card-meta">
                                <span className={`board-card-deadline ${deadlineClass}`}>{deadlineText}</span>
                                <span className="board-card-prazo-type">{card.etapa.tipo_prazo === 'uteis' ? 'dias úteis' : 'dias corridos'}</span>
                              </div>

                              <div
                                className="board-card-assignee board-card-assignee--clickable"
                                style={{ cursor: 'pointer', position: 'relative' }}
                                onClick={() => setAssignDropdown(assignDropdown?.etapaId === card.etapa.id ? null : card.etapa.id != null ? { etapaId: card.etapa.id } : null)}
                              >
                                {card.membro ? (
                                  <>
                                    <div className="avatar" style={{ width: 22, height: 22, fontSize: '0.6rem', background: getAvatarColor(card.membro.nome), color: '#fff' }}>
                                      {getInitials(card.membro.nome)}
                                    </div>
                                    <span>{card.membro.nome}</span>
                                  </>
                                ) : (
                                  <span style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>Sem responsável</span>
                                )}
                              </div>

                              {assignDropdown?.etapaId === card.etapa.id && (
                                <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '0.25rem 0', zIndex: 100, marginTop: '0.25rem' }}>
                                  <button
                                    className="assignee-dropdown-item"
                                    onClick={() => handleAssignMember(card.etapa.id!, null)}
                                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', padding: '0.4rem 0.75rem', background: 'none', border: 'none', cursor: 'pointer' }}
                                  >
                                    Sem responsável
                                  </button>
                                  {membros.map(m => (
                                    <button
                                      key={m.id}
                                      className={`assignee-dropdown-item${card.etapa.responsavel_id === m.id ? ' active' : ''}`}
                                      onClick={() => handleAssignMember(card.etapa.id!, m.id!)}
                                      style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', padding: '0.4rem 0.75rem', background: 'none', border: 'none', cursor: 'pointer' }}
                                    >
                                      <div className="avatar" style={{ width: 20, height: 20, fontSize: '0.55rem', background: getAvatarColor(m.nome), color: '#fff', flexShrink: 0 }}>
                                        {getInitials(m.nome)}
                                      </div>
                                      {m.nome}
                                    </button>
                                  ))}
                                </div>
                              )}

                              {(card.workflow.link_notion || card.workflow.link_drive) && (
                                <div className="board-card-links">
                                  {card.workflow.link_notion && (
                                    <a href={sanitizeUrl(card.workflow.link_notion)} target="_blank" rel="noopener noreferrer" className="board-card-link">
                                      Notion
                                    </a>
                                  )}
                                  {card.workflow.link_drive && (
                                    <a href={sanitizeUrl(card.workflow.link_drive)} target="_blank" rel="noopener noreferrer" className="board-card-link">
                                      Drive
                                    </a>
                                  )}
                                </div>
                              )}

                              <div className="board-card-progress">
                                <div className="board-progress-bar">
                                  <div className="board-progress-fill" style={{ width: `${progressPct}%` }} />
                                </div>
                                <span className="board-progress-label">{card.etapaIdx + 1}/{card.totalEtapas}</span>
                              </div>

                              {iniciadoEm && (
                                <div className="board-card-created">iniciada em {iniciadoEm}</div>
                              )}

                                {card.etapa.tipo === 'aprovacao_cliente' && (() => {
                                  const approvals = approvalsMap.get(card.etapa.id!) || [];
                                  const comments = approvals.filter(a => a.comentario); // Show all comments in thread
                                  const hasPendingClientCorrection = approvals.some(a => a.action === 'correcao');
                                  return (
                                    <div className="board-card-approval">
                                      <div className="board-card-approval-badge">
                                        ⏳ Aguardando aprovação do cliente
                                      </div>
                                      {comments.length > 0 && (
                                      <div className="board-card-approval-thread">
                                        <div className="board-card-approval-thread-title">
                                          Mensagens ({comments.length})
                                        </div>
                                        {comments.slice(0, 5).map(c => (
                                          <div key={c.id} className="board-card-approval-comment" style={c.is_workspace_user ? { borderLeft: '2px solid var(--primary-color)' } : {}}>
                                            <p>{c.comentario}</p>
                                            <span className="board-card-approval-date">
                                              {c.is_workspace_user ? 'Sua equipe' : 'Cliente'} &bull; {new Date(c.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                          </div>
                                        ))}
                                        {comments.length > 5 && (
                                          <span className="board-card-approval-more">+{comments.length - 5} mais</span>
                                        )}
                                        
                                        {/* Reply Box */}
                                        <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
                                          <Input 
                                            placeholder="Responder cliente..." 
                                            value={replyTexts[card.etapa.id!] || ''}
                                            onChange={e => setReplyTexts(p => ({ ...p, [card.etapa.id!]: e.target.value }))}
                                            style={{ fontSize: '0.75rem', height: '28px', backgroundColor: 'var(--card-bg)' }}
                                            onKeyDown={e => {
                                              if (e.key === 'Enter') handleReply(card.workflow.id!, card.etapa.id!);
                                            }}
                                          />
                                          <Button 
                                            size="sm" 
                                            variant="secondary" 
                                            onClick={() => handleReply(card.workflow.id!, card.etapa.id!)}
                                            style={{ height: '28px', padding: '0 0.5rem' }}
                                            disabled={submittingReply === card.etapa.id!}
                                          >
                                            {submittingReply === card.etapa.id! ? <Spinner className="h-3 w-3" /> : <Send className="h-3 w-3" />}
                                          </Button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}

                              <div className="board-card-actions">
                                {card.etapaIdx > 0 && (
                                  <button
                                    className="btn-revert-etapa"
                                    onClick={() => setRevertWfId(card.workflow.id!)}
                                    title="Voltar etapa"
                                    style={{ padding: '0.4rem', flexShrink: 0 }}
                                  >
                                    <ArrowLeft className="h-4 w-4" />
                                  </button>
                                )}
                                <button
                                  className="btn-edit-workflow"
                                  onClick={() => setEditCard(card)}
                                  title="Editar fluxo"
                                  style={{ padding: '0.4rem', flexShrink: 0 }}
                                >
                                  <Edit2 className="h-4 w-4" />
                                </button>
                                <button
                                  className="btn-edit-workflow"
                                  onClick={async () => {
                                    try {
                                      const portalToken = await createPortalToken(card.workflow.id!);
                                      const url = `${window.location.origin}/#/portal/${portalToken}`;
                                      try {
                                        await navigator.clipboard.writeText(url);
                                      } catch {
                                        // Fallback for mobile browsers where clipboard API is restricted
                                        const ta = document.createElement('textarea');
                                        ta.value = url;
                                        ta.style.position = 'fixed';
                                        ta.style.opacity = '0';
                                        document.body.appendChild(ta);
                                        ta.focus();
                                        ta.select();
                                        document.execCommand('copy');
                                        document.body.removeChild(ta);
                                      }
                                      toast.success('Link do portal copiado!');
                                    } catch {
                                      toast.error('Erro ao gerar link do portal.');
                                    }
                                  }}
                                  title="Compartilhar portal do cliente"
                                  style={{ padding: '0.4rem', flexShrink: 0 }}
                                >
                                  <Share2 className="h-4 w-4" />
                                </button>
                                <button
                                  className="btn-complete-etapa"
                                  onClick={() => handleCompleteEtapa(card.workflow.id!, card.etapa.id!)}
                                  title="Concluir etapa"
                                  style={{ padding: '0.4rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                                >
                                  <Check className="h-4 w-4" /> Concluir
                                </button>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      <NewWorkflowModal
        open={newWorkflowOpen}
        onClose={() => setNewWorkflowOpen(false)}
        clientes={clientes}
        membros={membros}
        templates={templates}
        onCreated={refresh}
      />

      <TemplatesModal
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        templates={templates}
        membros={membros}
        onRefresh={refresh}
      />

      {editCard && (
        <EditWorkflowModal
          card={editCard}
          membros={membros}
          clientes={clientes}
          onClose={() => setEditCard(null)}
          onSaved={refresh}
          onDeleted={refresh}
        />
      )}

      <AlertDialog open={recurringWfId !== null} onOpenChange={open => { if (!open) { setRecurringWfId(null); refresh(); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fluxo Recorrente</AlertDialogTitle>
            <AlertDialogDescription>Este fluxo é recorrente. Deseja criar um novo ciclo com as mesmas etapas?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setRecurringWfId(null); refresh(); }}>Não</AlertDialogCancel>
            <AlertDialogAction onClick={handleRecurringConfirm}>Sim, criar novo ciclo</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={revertWfId !== null} onOpenChange={open => { if (!open) setRevertWfId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Voltar Etapa</AlertDialogTitle>
            <AlertDialogDescription>Deseja mover este fluxo para a etapa anterior? A etapa atual será resetada.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleRevertExecute}>Confirmar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
