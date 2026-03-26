import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Edit2, MapPin, Plus, Pencil, Trash2, Building2, Home, Loader2, Cake, CalendarDays } from 'lucide-react';
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
  getClienteEnderecos,
  addClienteEndereco,
  updateClienteEndereco,
  removeClienteEndereco,
  getClienteDatas,
  addClienteData,
  updateClienteData,
  removeClienteData,
  type Cliente,
  type ClienteEndereco,
  type ClienteData,
  type Workflow,
  type WorkflowEtapa,
  type Contrato,
  type Transacao,
} from '../../store';
import { getInstagramSummary, syncInstagramData } from '../../services/instagram';
import { sanitizeUrl } from '../../utils/security';
import { useAuth } from '../../context/AuthContext';
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
  const { role } = useAuth();
  const isAgent = role === 'agent';
  const [editOpen, setEditOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [recurringWfId, setRecurringWfId] = useState<number | null>(null);

  // Address modal state
  const [addrModalOpen, setAddrModalOpen] = useState(false);
  const [addrLoading, setAddrLoading] = useState(false);
  const [addrEditing, setAddrEditing] = useState<ClienteEndereco | null>(null);
  const [addrDeleteId, setAddrDeleteId] = useState<number | null>(null);
  const [adrTipo, setAdrTipo] = useState<'residencial' | 'comercial'>('comercial');
  const [adrLogradouro, setAdrLogradouro] = useState('');
  const [adrNumero, setAdrNumero] = useState('');
  const [adrComplemento, setAdrComplemento] = useState('');
  const [adrBairro, setAdrBairro] = useState('');
  const [adrCidade, setAdrCidade] = useState('');
  const [adrEstado, setAdrEstado] = useState('');
  const [adrCep, setAdrCep] = useState('');
  const [cepLoading, setCepLoading] = useState(false);

  // Important dates modal state
  const [dateModalOpen, setDateModalOpen] = useState(false);
  const [dateLoading, setDateLoading] = useState(false);
  const [dateEditing, setDateEditing] = useState<ClienteData | null>(null);
  const [dateDeleteId, setDateDeleteId] = useState<number | null>(null);
  const [dateTitulo, setDateTitulo] = useState('');
  const [dateData, setDateData] = useState('');

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
  const [fAniMes, setFAniMes] = useState(''); // '01'–'12'
  const [fAniDia, setFAniDia] = useState(''); // '01'–'31'

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
  const { data: enderecos, isLoading: loadingEnderecos } = useQuery({
    queryKey: ['clienteEnderecos', clienteId],
    queryFn: () => getClienteEnderecos(clienteId),
    enabled: !isNaN(clienteId),
  });
  const { data: datasImportantes, isLoading: loadingDatas } = useQuery({
    queryKey: ['clienteDatas', clienteId],
    queryFn: () => getClienteDatas(clienteId),
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
      if (igChartRef.current) renderInstagramFollowerChart(igChartRef.current, igSummary.history ?? []);
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
    const [aniMes = '', aniDia = ''] = (cliente.data_aniversario || '').split('-');
    setFAniMes(aniMes); setFAniDia(aniDia);
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
        data_aniversario: fAniMes && fAniDia ? `${fAniMes}-${fAniDia}` : null,
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

  // Address handlers
  const resetAddrForm = () => {
    setAdrTipo('comercial'); setAdrLogradouro(''); setAdrNumero('');
    setAdrComplemento(''); setAdrBairro(''); setAdrCidade('');
    setAdrEstado(''); setAdrCep(''); setAddrEditing(null);
  };

  const handleOpenAddrModal = (addr?: ClienteEndereco) => {
    if (addr) {
      setAddrEditing(addr);
      setAdrTipo(addr.tipo); setAdrLogradouro(addr.logradouro); setAdrNumero(addr.numero);
      setAdrComplemento(addr.complemento || ''); setAdrBairro(addr.bairro);
      setAdrCidade(addr.cidade); setAdrEstado(addr.estado); setAdrCep(addr.cep);
    } else {
      resetAddrForm();
    }
    setAddrModalOpen(true);
  };

  const handleCepChange = async (rawCep: string) => {
    setAdrCep(rawCep);
    const digits = rawCep.replace(/\D/g, '');
    if (digits.length !== 8) return;
    setCepLoading(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const data = await res.json();
      if (data.erro) {
        toast.error('CEP não encontrado.');
      } else {
        if (data.logradouro) setAdrLogradouro(data.logradouro);
        if (data.bairro) setAdrBairro(data.bairro);
        if (data.localidade) setAdrCidade(data.localidade);
        if (data.uf) setAdrEstado(data.uf);
      }
    } catch {
      // silent — user can fill manually
    } finally {
      setCepLoading(false);
    }
  };

  const handleAddrSubmit = async () => {
    if (!adrLogradouro || !adrNumero || !adrBairro || !adrCidade || !adrEstado || !adrCep) {
      toast.error('Preencha todos os campos obrigatórios.'); return;
    }
    setAddrLoading(true);
    try {
      const payload = {
        cliente_id: clienteId, tipo: adrTipo, logradouro: adrLogradouro,
        numero: adrNumero, complemento: adrComplemento, bairro: adrBairro,
        cidade: adrCidade, estado: adrEstado, cep: adrCep,
      };
      if (addrEditing?.id) {
        await updateClienteEndereco(addrEditing.id, payload);
        toast.success('Endereço atualizado!');
      } else {
        await addClienteEndereco(payload);
        toast.success('Endereço adicionado!');
      }
      queryClient.invalidateQueries({ queryKey: ['clienteEnderecos', clienteId] });
      setAddrModalOpen(false);
      resetAddrForm();
    } catch (err: unknown) {
      toast.error('Erro ao salvar endereço: ' + (err as Error).message);
    } finally {
      setAddrLoading(false);
    }
  };

  const handleAddrDelete = async () => {
    if (!addrDeleteId) return;
    try {
      await removeClienteEndereco(addrDeleteId);
      queryClient.invalidateQueries({ queryKey: ['clienteEnderecos', clienteId] });
      toast.success('Endereço removido!');
    } catch (err: unknown) {
      toast.error('Erro ao remover: ' + (err as Error).message);
    }
    setAddrDeleteId(null);
  };

  // Important dates handlers
  const resetDateForm = () => {
    setDateTitulo(''); setDateData(''); setDateEditing(null);
  };

  const handleOpenDateModal = (d?: ClienteData) => {
    if (d) {
      setDateEditing(d);
      setDateTitulo(d.titulo); setDateData(d.data);
    } else {
      resetDateForm();
    }
    setDateModalOpen(true);
  };

  const handleDateSubmit = async () => {
    if (!dateTitulo || !dateData) {
      toast.error('Preencha título e data.'); return;
    }
    setDateLoading(true);
    try {
      if (dateEditing?.id) {
        await updateClienteData(dateEditing.id, { titulo: dateTitulo, data: dateData });
        toast.success('Data atualizada!');
      } else {
        await addClienteData({ cliente_id: clienteId, titulo: dateTitulo, data: dateData });
        toast.success('Data adicionada!');
      }
      queryClient.invalidateQueries({ queryKey: ['clienteDatas', clienteId] });
      setDateModalOpen(false);
      resetDateForm();
    } catch (err: unknown) {
      toast.error('Erro: ' + (err as Error).message);
    } finally {
      setDateLoading(false);
    }
  };

  const handleDateDelete = async () => {
    if (!dateDeleteId) return;
    try {
      await removeClienteData(dateDeleteId);
      queryClient.invalidateQueries({ queryKey: ['clienteDatas', clienteId] });
      toast.success('Data removida!');
    } catch (err: unknown) {
      toast.error('Erro: ' + (err as Error).message);
    }
    setDateDeleteId(null);
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

      {/* Info Card */}
      <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
        <h3 className="text-xl font-bold tracking-tight mb-4 text-foreground">Informações</h3>
        <div className="client-info-grid">
          <div className="client-info-item"><span className="client-info-label">Email</span><span className="client-info-value">{cliente.email || '—'}</span></div>
          <div className="client-info-item"><span className="client-info-label">Telefone</span><span className="client-info-value">{cliente.telefone || '—'}</span></div>
          <div className="client-info-item"><span className="client-info-label">Dia de Pagamento</span><span className="client-info-value">{cliente.data_pagamento ? `Dia ${cliente.data_pagamento}` : '—'}</span></div>
          <div className="client-info-item"><span className="client-info-label">Especialidade</span><span className="client-info-value">{cliente.especialidade || '—'}</span></div>
          <div className="client-info-item">
            <span className="client-info-label">Aniversário</span>
            <span className="client-info-value" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              {cliente.data_aniversario
                ? (() => {
                    const [mm, dd] = cliente.data_aniversario.split('-');
                    const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
                    return <><Cake className="h-4 w-4" style={{ color: 'var(--pink, #f542c8)' }} />{`${parseInt(dd)} de ${meses[parseInt(mm) - 1]}`}</>;
                  })()
                : '—'}
            </span>
          </div>
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

      {/* Important Dates Section */}
      <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2 mb-0">
            <CalendarDays className="h-5 w-5" style={{ color: 'var(--primary-color)' }} />
            Datas Importantes
          </h3>
          <Button size="sm" onClick={() => handleOpenDateModal()}>
            <Plus className="h-4 w-4" style={{ marginRight: 4 }} /> Adicionar
          </Button>
        </div>

        {loadingDatas && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '1.5rem' }}>
            <Spinner size="sm" />
          </div>
        )}

        {!loadingDatas && (!datasImportantes || datasImportantes.length === 0) && (
          <div style={{
            textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-muted)',
            border: '1px dashed var(--border-color)', borderRadius: '12px',
          }}>
            <CalendarDays className="h-8 w-8" style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
            <p style={{ fontSize: '0.9rem' }}>Nenhuma data importante cadastrada</p>
            <p style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>Clique em "Adicionar" para registrar datas relevantes.</p>
          </div>
        )}

        {!loadingDatas && datasImportantes && datasImportantes.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '0.75rem' }}>
            {datasImportantes.map(d => (
              <div key={d.id} style={{
                padding: '0.75rem 1rem', borderRadius: '12px',
                border: '1px solid var(--border-color)', background: 'var(--surface-main)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                transition: 'box-shadow 0.2s ease, transform 0.2s ease',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLDivElement).style.boxShadow = '0 6px 16px rgba(0,0,0,0.08)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ''; (e.currentTarget as HTMLDivElement).style.boxShadow = ''; }}
              >
                <div>
                  <p style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.1rem' }}>{d.titulo}</p>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{formatDate(d.data)}</p>
                </div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <Button variant="ghost" size="icon" style={{ width: 28, height: 28 }}
                    onClick={() => handleOpenDateModal(d)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" style={{ width: 28, height: 28, color: 'var(--danger)' }}
                    onClick={() => setDateDeleteId(d.id!)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Addresses Section */}
      <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2 mb-0">
            <MapPin className="h-5 w-5" style={{ color: 'var(--primary-color)' }} />
            Endereços
          </h3>
          <Button size="sm" onClick={() => handleOpenAddrModal()}>
            <Plus className="h-4 w-4" style={{ marginRight: 4 }} /> Adicionar
          </Button>
        </div>

        {loadingEnderecos && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '1.5rem' }}>
            <Spinner size="sm" />
          </div>
        )}

        {!loadingEnderecos && (!enderecos || enderecos.length === 0) && (
          <div style={{
            textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-muted)',
            border: '1px dashed var(--border-color)', borderRadius: '12px',
          }}>
            <MapPin className="h-8 w-8" style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
            <p style={{ fontSize: '0.9rem' }}>Nenhum endereço cadastrado</p>
            <p style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>Clique em "Adicionar" para cadastrar um endereço.</p>
          </div>
        )}

        {!loadingEnderecos && enderecos && enderecos.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '0.75rem' }}>
            {enderecos.map(addr => (
              <div key={addr.id} style={{
                position: 'relative', padding: '1rem 1.25rem', borderRadius: '12px',
                border: '1px solid var(--border-color)', background: 'var(--surface-main)',
                transition: 'box-shadow 0.2s ease, transform 0.2s ease',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLDivElement).style.boxShadow = '0 6px 16px rgba(0,0,0,0.08)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ''; (e.currentTarget as HTMLDivElement).style.boxShadow = ''; }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                  <span className={`badge ${addr.tipo === 'residencial' ? 'badge-info' : 'badge-warning'}`}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem' }}>
                    {addr.tipo === 'residencial'
                      ? <><Home className="h-3 w-3" /> Residencial</>
                      : <><Building2 className="h-3 w-3" /> Comercial</>}
                  </span>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <Button variant="ghost" size="icon" style={{ width: 28, height: 28 }}
                      onClick={() => handleOpenAddrModal(addr)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" style={{ width: 28, height: 28, color: 'var(--danger)' }}
                      onClick={() => setAddrDeleteId(addr.id!)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <p style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.15rem' }}>
                  {addr.logradouro}, {addr.numero}{addr.complemento ? ` — ${addr.complemento}` : ''}
                </p>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {addr.bairro} · {addr.cidade}/{addr.estado}
                </p>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  CEP: {addr.cep}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Instagram Section */}
      <div id="ig-container" style={{ marginBottom: '1.5rem' }}>
        <h3 className="text-xl font-bold tracking-tight mb-4 text-foreground">Instagram</h3>
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
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1.5rem', marginBottom: '1rem' }}>
              <Button onClick={() => navigate(`/analytics/${clienteId}`)}>
                Ver Analytics Completo →
              </Button>
            </div>
          </>
        )}
        {!loadingIg && !igSummary && <div ref={igConnectRef} />}
      </div>

      {/* Workflows Section */}
      {workflowsWithEtapas.length > 0 && (
        <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
          <h3 className="text-xl font-bold tracking-tight mb-4 text-foreground">Entregas Ativas</h3>
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

      {!isAgent && (
        <>
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

          {/* Contratos Table */}
          <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
            <h3 className="text-xl font-bold tracking-tight mb-4 text-foreground">Contratos</h3>
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
                    <TableCell data-label="Título">{r.titulo}</TableCell>
                    <TableCell data-label="Período">{formatDate(r.data_inicio)} – {formatDate(r.data_fim)}</TableCell>
                    <TableCell data-label="Valor">{formatBRL(Number(r.valor_total))}</TableCell>
                    <TableCell data-label="Status"><StatusBadge status={r.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Transações Table */}
          <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
            <h3 className="text-xl font-bold tracking-tight mb-4 text-foreground">Transações</h3>
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
                    <TableCell data-label="Descrição">{r.descricao}</TableCell>
                    <TableCell data-label="Data">{formatDate(r.data)}</TableCell>
                    <TableCell data-label="Valor">
                      <span style={{ color: r.tipo === 'entrada' ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
                        {r.tipo === 'entrada' ? '+' : '-'}{formatBRL(Number(r.valor))}
                      </span>
                    </TableCell>
                    <TableCell data-label="Status"><StatusBadge status={r.status ?? 'pago'} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

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
            <div className="space-y-1">
              <Label>Aniversário (Dia e Mês)</Label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <Select value={fAniMes} onValueChange={setFAniMes}>
                  <SelectTrigger><SelectValue placeholder="Mês" /></SelectTrigger>
                  <SelectContent>
                    {[['01','Janeiro'],['02','Fevereiro'],['03','Março'],['04','Abril'],['05','Maio'],['06','Junho'],
                      ['07','Julho'],['08','Agosto'],['09','Setembro'],['10','Outubro'],['11','Novembro'],['12','Dezembro']]
                      .map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={fAniDia} onValueChange={setFAniDia}>
                  <SelectTrigger><SelectValue placeholder="Dia" /></SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'))
                      .map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancelar</Button>
            <Button onClick={handleEditSubmit} disabled={editLoading}>{editLoading && <Spinner size="sm" />} Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Address Add/Edit Modal */}
      <Dialog open={addrModalOpen} onOpenChange={open => { if (!open) { setAddrModalOpen(false); resetAddrForm(); } }}>
        <DialogContent style={{ maxWidth: 540 }}>
          <DialogHeader>
            <DialogTitle>{addrEditing ? 'Editar Endereço' : 'Novo Endereço'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Tipo *</Label>
              <Select value={adrTipo} onValueChange={v => setAdrTipo(v as 'residencial' | 'comercial')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="comercial">Comercial</SelectItem>
                  <SelectItem value="residencial">Residencial</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>CEP *</Label>
              <div style={{ position: 'relative' }}>
                <Input placeholder="00000-000" value={adrCep} onChange={e => handleCepChange(e.target.value)} />
                {cepLoading && (
                  <div style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)' }}>
                    <Loader2 className="h-4 w-4 animate-spin" style={{ color: 'var(--primary-color)' }} />
                  </div>
                )}
              </div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>Digite o CEP para preencher automaticamente</p>
            </div>
            <div className="space-y-1"><Label>Logradouro *</Label><Input placeholder="Ex: Rua das Flores" value={adrLogradouro} onChange={e => setAdrLogradouro(e.target.value)} /></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.75rem' }}>
              <div className="space-y-1"><Label>Número *</Label><Input placeholder="123" value={adrNumero} onChange={e => setAdrNumero(e.target.value)} /></div>
              <div className="space-y-1"><Label>Complemento</Label><Input placeholder="Sala 1, Bloco B..." value={adrComplemento} onChange={e => setAdrComplemento(e.target.value)} /></div>
            </div>
            <div className="space-y-1"><Label>Bairro *</Label><Input placeholder="Centro" value={adrBairro} onChange={e => setAdrBairro(e.target.value)} /></div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem' }}>
              <div className="space-y-1"><Label>Cidade *</Label><Input placeholder="São Paulo" value={adrCidade} onChange={e => setAdrCidade(e.target.value)} /></div>
              <div className="space-y-1"><Label>Estado *</Label><Input placeholder="SP" maxLength={2} value={adrEstado} onChange={e => setAdrEstado(e.target.value.toUpperCase())} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAddrModalOpen(false); resetAddrForm(); }}>Cancelar</Button>
            <Button onClick={handleAddrSubmit} disabled={addrLoading}>{addrLoading && <Spinner size="sm" />} {addrEditing ? 'Salvar' : 'Adicionar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Address Delete Confirm */}
      <AlertDialog open={addrDeleteId !== null} onOpenChange={open => { if (!open) setAddrDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover Endereço</AlertDialogTitle>
            <AlertDialogDescription>Tem certeza que deseja remover este endereço? Esta ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleAddrDelete}>Remover</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Date Add/Edit Modal */}
      <Dialog open={dateModalOpen} onOpenChange={open => { if (!open) { setDateModalOpen(false); resetDateForm(); } }}>
        <DialogContent style={{ maxWidth: 440 }}>
          <DialogHeader>
            <DialogTitle>{dateEditing ? 'Editar Data' : 'Nova Data Importante'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label>Título *</Label><Input placeholder="Ex: Dia de inauguração" value={dateTitulo} onChange={e => setDateTitulo(e.target.value)} /></div>
            <div className="space-y-1"><Label>Data *</Label><Input type="date" value={dateData} onChange={e => setDateData(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDateModalOpen(false); resetDateForm(); }}>Cancelar</Button>
            <Button onClick={handleDateSubmit} disabled={dateLoading}>{dateLoading && <Spinner size="sm" />} {dateEditing ? 'Salvar' : 'Adicionar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Date Delete Confirm */}
      <AlertDialog open={dateDeleteId !== null} onOpenChange={open => { if (!open) setDateDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover Data</AlertDialogTitle>
            <AlertDialogDescription>Tem certeza que deseja remover esta data? Esta ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDateDelete}>Remover</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
