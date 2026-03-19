import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Edit2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  getClientes,
  getTransacoes,
  getContratos,
  formatBRL,
  formatDate,
  getInitials,
  updateCliente,
  getWorkflowsByCliente,
  getWorkflowEtapas,
  getDeadlineInfo,
  getMembros,
  completeEtapa,
  duplicateWorkflow,
  type Cliente,
  type Workflow,
  type WorkflowEtapa,
  type Contrato,
  type Transacao,
} from '../../store';
import { getInstagramSummary, syncInstagramData } from '../../services/instagram';
import { sanitizeUrl } from '../../utils/security';
import { renderInstagramOverviewCard } from '../../components/instagram/InstagramOverviewCard';
import { renderInstagramFollowerChart } from '../../components/instagram/InstagramFollowerChart';
import { renderInstagramPostsTable } from '../../components/instagram/InstagramPostsTable';
import { renderInstagramConnectButton } from '../../components/instagram/InstagramConnectButton';

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    ativo: 'badge-success', pausado: 'badge-warning', encerrado: 'badge-danger',
    vigente: 'badge-success', a_assinar: 'badge-warning', pago: 'badge-success', agendado: 'badge-neutral',
  };
  return <span className={`badge ${map[status] ?? 'badge-neutral'}`}>{status}</span>;
}

interface WorkflowWithEtapas { workflow: Workflow; etapas: WorkflowEtapa[] }

export default function ClienteDetalhePage() {
  const { id: idParam } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [recurringWfId, setRecurringWfId] = useState<number | null>(null);

  // Form state
  const [fNome, setFNome] = useState('');
  const [fEmail, setFEmail] = useState('');
  const [fTelefone, setFTelefone] = useState('');
  const [fPlano, setFPlano] = useState('');
  const [fValor, setFValor] = useState('');
  const [fNotion, setFNotion] = useState('');
  const [fDiaPag, setFDiaPag] = useState('');
  const [fStatus, setFStatus] = useState<Cliente['status']>('ativo');
  const [fEspecialidade, setFEspecialidade] = useState('');

  const clienteId = parseInt(idParam ?? '', 10);
  useEffect(() => {
    if (isNaN(clienteId)) navigate('/clientes');
  }, [clienteId, navigate]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('ig_error') === 'no_business_account') {
      toast.error('A conta Instagram não é uma conta Business. Reconecte com uma conta Business ou Creator.');
    }
  }, []);

  const { data: clientes, isLoading: loadingClientes } = useQuery({ queryKey: ['clientes'], queryFn: getClientes });
  const { data: transacoes, isLoading: loadingTx } = useQuery({ queryKey: ['transacoes'], queryFn: getTransacoes });
  const { data: contratos, isLoading: loadingContratos } = useQuery({ queryKey: ['contratos'], queryFn: getContratos });
  const { data: igSummary, isLoading: loadingIg, refetch: refetchIg } = useQuery({
    queryKey: ['igSummary', clienteId],
    queryFn: () => getInstagramSummary(clienteId).catch(() => null),
    enabled: !isNaN(clienteId),
  });
  const { data: clienteWorkflowsRaw, isLoading: loadingWf } = useQuery({
    queryKey: ['workflowsByCliente', clienteId],
    queryFn: () => getWorkflowsByCliente(clienteId),
    enabled: !isNaN(clienteId),
  });
  useQuery({ queryKey: ['membros'], queryFn: getMembros });

  const isLoading = loadingClientes || loadingTx || loadingContratos || loadingIg || loadingWf;

  const cliente: Cliente | undefined = (clientes ?? []).find(c => c.id === clienteId);

  const [workflowsWithEtapas, setWorkflowsWithEtapas] = useState<WorkflowWithEtapas[]>([]);
  useEffect(() => {
    const activeWfs = (clienteWorkflowsRaw ?? []).filter(w => w.status === 'ativo');
    if (activeWfs.length === 0) { setWorkflowsWithEtapas([]); return; }
    Promise.all(activeWfs.map(async w => ({ workflow: w, etapas: await getWorkflowEtapas(w.id!) })))
      .then(setWorkflowsWithEtapas)
      .catch(() => setWorkflowsWithEtapas([]));
  }, [clienteWorkflowsRaw]);

  const igSyncAttempted = useRef(false);
  useEffect(() => {
    if (!igSummary || igSyncAttempted.current) return;
    if (!igSummary.account?.last_synced_at) {
      igSyncAttempted.current = true;
      syncInstagramData(clienteId).then(() => refetchIg()).catch(() => refetchIg());
    }
  }, [igSummary, clienteId, refetchIg]);

  const igOverviewRef = useRef<HTMLDivElement>(null);
  const igChartRef = useRef<HTMLDivElement>(null);
  const igPostsRef = useRef<HTMLDivElement>(null);
  const igConnectRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!igSummary) {
      if (igConnectRef.current && !isNaN(clienteId)) {
        renderInstagramConnectButton(igConnectRef.current, clienteId);
      }
      return;
    }
    if (igSummary.account?.last_synced_at) {
      if (igOverviewRef.current) renderInstagramOverviewCard(igOverviewRef.current, clienteId, igSummary.account, () => refetchIg());
      if (igChartRef.current) renderInstagramFollowerChart(igChartRef.current, igSummary.follower_history ?? []);
      if (igPostsRef.current) renderInstagramPostsTable(igPostsRef.current, clienteId);
    }
  }, [igSummary, clienteId, refetchIg]);

  const handleCompleteEtapa = async (workflow: Workflow, etapa: WorkflowEtapa) => {
    try {
      const { workflow: updatedWf } = await completeEtapa(workflow.id!, etapa.id!);
      if (updatedWf.status === 'concluido' && workflow.recorrente) {
        setRecurringWfId(workflow.id!);
      } else {
        queryClient.invalidateQueries({ queryKey: ['workflowsByCliente', clienteId] });
        toast.success('Etapa concluída!');
      }
    } catch (err: unknown) {
      toast.error('Erro ao concluir etapa: ' + (err as Error).message);
    }
  };

  const handleRecurringConfirm = async () => {
    if (!recurringWfId) return;
    try {
      await duplicateWorkflow(recurringWfId);
      queryClient.invalidateQueries({ queryKey: ['workflowsByCliente', clienteId] });
      toast.success('Novo ciclo criado!');
    } catch { toast.error('Erro ao criar ciclo'); }
    setRecurringWfId(null);
  };

  const handleEdit = () => {
    if (!cliente) return;
    setFNome(cliente.nome); setFEmail(cliente.email || ''); setFTelefone(cliente.telefone || '');
    setFPlano(cliente.plano || ''); setFValor(cliente.valor_mensal ? String(cliente.valor_mensal) : '');
    setFNotion(cliente.notion_page_url || ''); setFDiaPag(cliente.data_pagamento ? String(cliente.data_pagamento) : '');
    setFStatus(cliente.status); setFEspecialidade(cliente.especialidade || '');
    setEditOpen(true);
  };

  const handleEditSubmit = async () => {
    if (!fNome) { toast.error('Nome é obrigatório.'); return; }
    setEditLoading(true);
    try {
      await updateCliente(clienteId, {
        nome: fNome, email: fEmail, telefone: fTelefone, plano: fPlano,
        valor_mensal: fValor ? Number(fValor) : undefined,
        notion_page_url: fNotion,
        data_pagamento: fDiaPag ? Number(fDiaPag) : undefined,
        status: fStatus, especialidade: fEspecialidade,
      });
      queryClient.invalidateQueries({ queryKey: ['clientes'] });
      setEditOpen(false);
      toast.success('Cliente atualizado!');
    } catch (err: unknown) {
      toast.error('Erro ao salvar: ' + (err as Error).message);
    } finally {
      setEditLoading(false);
    }
  };

  const contratosCliente: Contrato[] = (contratos ?? []).filter(c => c.cliente_id === clienteId);
  const transacoesCliente: Transacao[] = (transacoes ?? []).filter(t => t.cliente_id === clienteId);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (!cliente) {
    return (
      <div className="card" style={{ margin: '2rem', textAlign: 'center', padding: '3rem' }}>
        <h2>Cliente não encontrado</h2>
        <Button onClick={() => navigate('/clientes')} style={{ marginTop: 16 }}>Voltar</Button>
      </div>
    );
  }

  const receitaTotal = transacoesCliente.filter(t => t.tipo === 'entrada' && t.status === 'pago').reduce((s, t) => s + Number(t.valor), 0);
  const pendente = transacoesCliente.filter(t => t.tipo === 'entrada' && t.status === 'agendado').reduce((s, t) => s + Number(t.valor), 0);

  return (
    <div style={{ padding: '1.5rem' }}>
      {/* Header */}
      <div className="header" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Button variant="outline" size="icon" onClick={() => navigate('/clientes')}><ArrowLeft className="h-4 w-4" /></Button>
          <div className="avatar" style={{ background: cliente.cor, width: 48, height: 48, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: '1.1rem', flexShrink: 0 }}>
            {getInitials(cliente.nome)}
          </div>
          <div>
            <h2 className="header-title" style={{ margin: 0 }}>{cliente.nome}</h2>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <span className="badge badge-neutral">{cliente.plano}</span>
              <StatusBadge status={cliente.status} />
            </div>
          </div>
        </div>
        <div className="header-actions">
          <Button variant="outline" onClick={handleEdit}><Edit2 className="h-4 w-4" /> Editar</Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="kpi-card animate-up">
          <span className="kpi-label">VALOR MENSAL</span>
          <span className="kpi-value">{formatBRL(Number(cliente.valor_mensal))}</span>
        </div>
        <div className="kpi-card animate-up">
          <span className="kpi-label">TOTAL RECEBIDO</span>
          <span className="kpi-value">{formatBRL(receitaTotal)}</span>
        </div>
        <div className="kpi-card animate-up">
          <span className="kpi-label">PENDENTE</span>
          <span className="kpi-value" style={{ color: 'var(--warning)' }}>{formatBRL(pendente)}</span>
        </div>
      </div>

      {/* Info Card */}
      <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ marginBottom: '1rem' }}>Informações</h3>
        <div className="client-info-grid">
          <div className="client-info-item"><span className="client-info-label">Email</span><span className="client-info-value">{cliente.email || '—'}</span></div>
          <div className="client-info-item"><span className="client-info-label">Telefone</span><span className="client-info-value">{cliente.telefone || '—'}</span></div>
          <div className="client-info-item"><span className="client-info-label">Dia de Pagamento</span><span className="client-info-value">{cliente.data_pagamento ? `Dia ${cliente.data_pagamento}` : '—'}</span></div>
          <div className="client-info-item"><span className="client-info-label">Especialidade</span><span className="client-info-value">{cliente.especialidade || '—'}</span></div>
          {cliente.notion_page_url && (
            <div className="client-info-item">
              <span className="client-info-label">Notion</span>
              <span className="client-info-value">
                <a href={sanitizeUrl(cliente.notion_page_url)} target="_blank" rel="noopener noreferrer">Abrir no Notion</a>
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Instagram Section */}
      <div id="ig-container" style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ marginBottom: '1rem' }}>Instagram</h3>
        {loadingIg && <div className="flex justify-center p-4"><Spinner size="lg" /></div>}
        {!loadingIg && igSummary && !igSummary.account?.last_synced_at && (
          <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
            <Spinner size="lg" />
            <p style={{ color: 'var(--text-muted)', marginTop: 8 }}>Sincronizando dados do Instagram...</p>
          </div>
        )}
        {!loadingIg && igSummary && igSummary.account?.last_synced_at && (
          <>
            <div ref={igOverviewRef} />
            <div ref={igChartRef} />
            <div ref={igPostsRef} />
            <div style={{ textAlign: 'right', marginTop: 8 }}>
              <Link to={`/analytics/${clienteId}`}>Ver Analytics Completo →</Link>
            </div>
          </>
        )}
        {!loadingIg && !igSummary && <div ref={igConnectRef} />}
      </div>

      {/* Workflows Section */}
      {workflowsWithEtapas.length > 0 && (
        <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ marginBottom: '1rem' }}>Entregas Ativas</h3>
          {workflowsWithEtapas.map(({ workflow, etapas }) => {
            const activeEtapa = etapas.find(e => e.status === 'ativo');
            const deadline = activeEtapa ? getDeadlineInfo(activeEtapa) : null;
            return (
              <div key={workflow.id} className="card wf-flow-card" style={{ marginBottom: '1rem' }}>
                <div className="wf-flow-header">
                  <span className="wf-flow-title">{workflow.titulo}</span>
                  {activeEtapa && (
                    <Button size="sm" onClick={() => handleCompleteEtapa(workflow, activeEtapa)}>Concluir</Button>
                  )}
                </div>
                <div className="wf-steps-row">
                  {etapas.map(e => (
                    <span key={e.id} className={`wf-step-pill ${e.status === 'concluido' ? 'badge-success' : e.status === 'ativo' ? 'badge-info' : 'badge-neutral'}`}>
                      {e.nome}
                    </span>
                  ))}
                </div>
                {activeEtapa && deadline && (
                  <div className="wf-step-info" style={{ marginTop: 8, fontSize: '0.8rem', color: deadline.estourado ? 'var(--danger)' : deadline.urgente ? 'var(--warning)' : 'var(--text-muted)' }}>
                    {deadline.estourado ? `Estourado por ${Math.abs(deadline.diasRestantes)} dia(s)` : `${deadline.diasRestantes} dia(s) restante(s)`} — {activeEtapa.nome}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Contratos Table */}
      <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ marginBottom: '1rem' }}>Contratos</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Título</TableHead>
              <TableHead>Período</TableHead>
              <TableHead>Valor</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contratosCliente.length === 0 ? (
              <TableRow><TableCell colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Nenhum contrato</TableCell></TableRow>
            ) : contratosCliente.map(r => (
              <TableRow key={r.id ?? Math.random()}>
                <TableCell>{r.titulo}</TableCell>
                <TableCell>{formatDate(r.data_inicio)} – {formatDate(r.data_fim)}</TableCell>
                <TableCell>{formatBRL(Number(r.valor_total))}</TableCell>
                <TableCell><StatusBadge status={r.status} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Transações Table */}
      <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ marginBottom: '1rem' }}>Transações</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Descrição</TableHead>
              <TableHead>Data</TableHead>
              <TableHead>Valor</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transacoesCliente.length === 0 ? (
              <TableRow><TableCell colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Nenhuma transação</TableCell></TableRow>
            ) : transacoesCliente.map(r => (
              <TableRow key={r.id ?? Math.random()}>
                <TableCell>{r.descricao}</TableCell>
                <TableCell>{formatDate(r.data)}</TableCell>
                <TableCell>
                  <span style={{ color: r.tipo === 'entrada' ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
                    {r.tipo === 'entrada' ? '+' : '-'}{formatBRL(Number(r.valor))}
                  </span>
                </TableCell>
                <TableCell><StatusBadge status={r.status ?? 'pago'} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Edit Modal */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent style={{ maxWidth: 600 }}>
          <DialogHeader><DialogTitle>Editar Cliente</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label>Nome *</Label><Input value={fNome} onChange={e => setFNome(e.target.value)} /></div>
            <div className="space-y-1"><Label>Email</Label><Input type="email" value={fEmail} onChange={e => setFEmail(e.target.value)} /></div>
            <div className="space-y-1"><Label>Telefone</Label><Input value={fTelefone} onChange={e => setFTelefone(e.target.value)} /></div>
            <div className="space-y-1"><Label>Plano</Label><Input value={fPlano} onChange={e => setFPlano(e.target.value)} /></div>
            <div className="space-y-1"><Label>Valor Mensal</Label><Input type="number" value={fValor} onChange={e => setFValor(e.target.value)} /></div>
            <div className="space-y-1"><Label>Notion URL</Label><Input value={fNotion} onChange={e => setFNotion(e.target.value)} /></div>
            <div className="space-y-1"><Label>Dia de Pagamento</Label><Input type="number" min={1} max={31} value={fDiaPag} onChange={e => setFDiaPag(e.target.value)} /></div>
            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={fStatus} onValueChange={v => setFStatus(v as Cliente['status'])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ativo">Ativo</SelectItem>
                  <SelectItem value="pausado">Pausado</SelectItem>
                  <SelectItem value="encerrado">Encerrado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Especialidade</Label><Input value={fEspecialidade} onChange={e => setFEspecialidade(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancelar</Button>
            <Button onClick={handleEditSubmit} disabled={editLoading}>{editLoading && <Spinner size="sm" />} Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Recurring workflow confirm */}
      <AlertDialog open={recurringWfId !== null} onOpenChange={open => { if (!open) { setRecurringWfId(null); queryClient.invalidateQueries({ queryKey: ['workflowsByCliente', clienteId] }); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Workflow Concluído</AlertDialogTitle>
            <AlertDialogDescription>Este workflow é recorrente. Deseja criar um novo ciclo?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setRecurringWfId(null); queryClient.invalidateQueries({ queryKey: ['workflowsByCliente', clienteId] }); }}>Não</AlertDialogCancel>
            <AlertDialogAction onClick={handleRecurringConfirm}>Criar Novo Ciclo</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
