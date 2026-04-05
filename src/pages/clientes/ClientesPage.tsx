import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Plus, Edit2, Trash2, Upload, Info, HelpCircle, Search, ArrowUpDown } from 'lucide-react';
import { openCSVSelector } from '../../lib/csv';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import {
  getClientes, addCliente, updateCliente, removeCliente,
  getInitials,
  type Cliente,
} from '../../store';
import { sanitizeUrl } from '../../utils/security';
import { supabase } from '../../lib/supabase';

type FilterStatus = 'todos' | 'ativo' | 'pausado' | 'encerrado';
const STATUS_LABEL: Record<string, string> = { ativo: 'Ativo', pausado: 'Pausado', encerrado: 'Encerrado' };
const AVATAR_COLORS = ['#e74c3c','#8e44ad','#27ae60','#2980b9','#d35400','#16a085'];

async function fetchAvatars(clientIds: number[]): Promise<Record<number, string>> {
  if (!clientIds.length) return {};
  const { data } = await supabase.from('instagram_accounts').select('client_id, profile_picture_url').in('client_id', clientIds).not('profile_picture_url', 'is', null);
  const map: Record<number, string> = {};
  if (data) for (const row of data) if (row.client_id && row.profile_picture_url) map[row.client_id] = row.profile_picture_url;
  return map;
}

export default function ClientesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FilterStatus>('todos');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'nome' | 'valor_mensal' | 'data_pagamento'>('nome');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Cliente | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const [fNome, setFNome] = useState('');
  const [fEmail, setFEmail] = useState('');
  const [fTelefone, setFTelefone] = useState('');
  const [fPlano, setFPlano] = useState('');
  const [fValor, setFValor] = useState('');
  const [fNotion, setFNotion] = useState('');
  const [fDiaPag, setFDiaPag] = useState('');
  const [fStatus, setFStatus] = useState<Cliente['status']>('ativo');

  const { data: clientes = [], isLoading } = useQuery({ queryKey: ['clientes'], queryFn: getClientes });
  const { data: avatarMap = {} } = useQuery({
    queryKey: ['instagram_avatars', clientes.map(c => c.id).join(',')],
    queryFn: () => fetchAvatars(clientes.map(c => c.id as number).filter(Boolean)),
    enabled: clientes.length > 0,
  });

  const filtered = clientes
    .filter(c => filter === 'todos' || c.status === filter)
    .filter(c => !search || c.nome.toLowerCase().includes(search.toLowerCase()) || c.email?.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'nome') cmp = a.nome.localeCompare(b.nome);
      else if (sortBy === 'valor_mensal') cmp = (a.valor_mensal || 0) - (b.valor_mensal || 0);
      else if (sortBy === 'data_pagamento') cmp = (a.data_pagamento || 0) - (b.data_pagamento || 0);
      return sortDir === 'asc' ? cmp : -cmp;
    });

  const openAdd = () => {
    setEditing(null);
    setFNome(''); setFEmail(''); setFTelefone(''); setFPlano(''); setFValor(''); setFNotion(''); setFDiaPag(''); setFStatus('ativo');
    setModalOpen(true);
  };

  const openEdit = (c: Cliente) => {
    setEditing(c);
    setFNome(c.nome); setFEmail(c.email || ''); setFTelefone(c.telefone || ''); setFPlano(c.plano || '');
    setFValor(c.valor_mensal ? String(c.valor_mensal) : ''); setFNotion(c.notion_page_url || '');
    setFDiaPag(c.data_pagamento ? String(c.data_pagamento) : ''); setFStatus(c.status);
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!fNome) return;
    const diaPag = fDiaPag ? parseInt(fDiaPag, 10) : undefined;
    if (diaPag !== undefined && (isNaN(diaPag) || diaPag < 1 || diaPag > 31)) {
      toast.error('Dia de pagamento deve ser entre 1 e 31.');
      return;
    }
    setSaving(true);
    try {
      if (editing?.id) {
        await updateCliente(editing.id, {
          nome: fNome, email: fEmail, telefone: fTelefone, plano: fPlano,
          valor_mensal: Number(fValor), notion_page_url: fNotion,
          data_pagamento: diaPag, status: fStatus,
        });
        toast.success('Cliente atualizado');
      } else {
        const randomColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
        await addCliente({
          nome: fNome, email: fEmail, telefone: fTelefone, plano: fPlano,
          valor_mensal: Number(fValor), notion_page_url: fNotion,
          data_pagamento: diaPag,
          sigla: getInitials(fNome), cor: randomColor, status: 'ativo',
        });
        toast.success('Cliente adicionado');
      }
      qc.invalidateQueries({ queryKey: ['clientes'] });
      setModalOpen(false);
    } catch {
      toast.error('Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (deleteId == null) return;
    try {
      await removeCliente(deleteId);
      toast.success('Cliente removido');
      qc.invalidateQueries({ queryKey: ['clientes'] });
    } catch {
      toast.error('Erro ao remover');
    }
    setDeleteId(null);
  };

  const handleCSVImport = () => {
    openCSVSelector(
      async (rows) => {
        let count = 0;
        for (const row of rows) {
          if (!row.nome) continue;
          try {
            const randomColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
            await addCliente({
              nome: row.nome,
              email: row.email || '',
              telefone: row.telefone || '',
              plano: row.plano || '',
              valor_mensal: row.valor_mensal ? Number(row.valor_mensal) : 0,
              notion_page_url: row.notion_page_url || '',
              data_pagamento: row.data_pagamento ? Number(row.data_pagamento) : undefined,
              sigla: getInitials(row.nome),
              cor: randomColor,
              status: 'ativo',
            });
            count++;
          } catch { /* skip row */ }
        }
        toast.success(`${count} cliente${count !== 1 ? 's' : ''} importado${count !== 1 ? 's' : ''} com sucesso!`);
        qc.invalidateQueries({ queryKey: ['clientes'] });
      },
      (err) => toast.error(err.message),
    );
  };

  return (
    <div style={{ padding: '1.5rem' }}>
      <div className="header">
        <div className="header-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <h1>Clientes</h1>
          <span data-tooltip="Gerencie todos os clientes e contratos ativos." data-tooltip-dir="right" style={{ display: 'flex' }}>
            <Info className="h-5 w-5 cursor-pointer" style={{ color: 'var(--text-muted)' }} />
          </span>
        </div>
        <div className="header-actions">
          <span data-tooltip="Colunas: nome*, email, telefone, plano, valor_mensal, notion_page_url, data_pagamento" data-tooltip-dir="bottom" style={{ display: 'flex' }}>
            <HelpCircle className="h-4 w-4" style={{ color: 'var(--text-muted)', cursor: 'pointer' }} />
          </span>
          <Button variant="outline" onClick={handleCSVImport}><Upload className="h-4 w-4" style={{ marginRight: '0.5rem' }} /> Importar CSV</Button>
          <Button onClick={openAdd}><Plus className="h-4 w-4" style={{ marginRight: '0.5rem' }} /> Novo Cliente</Button>
        </div>
      </div>

      <div className="filter-bar" style={{ marginBottom: '1rem' }}>
        {(['todos', 'ativo', 'pausado', 'encerrado'] as FilterStatus[]).map(f => (
          <button key={f} className={`filter-btn${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
            {f === 'todos' ? 'Todos' : STATUS_LABEL[f]}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: '320px' }}>
          <Search className="h-4 w-4" style={{ position: 'absolute', left: '0.625rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <Input placeholder="Buscar por nome ou e-mail..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: '2rem' }} />
        </div>
        <Select value={sortBy} onValueChange={v => setSortBy(v as typeof sortBy)}>
          <SelectTrigger style={{ width: '180px' }}>
            <ArrowUpDown className="h-3.5 w-3.5" style={{ marginRight: '0.375rem', flexShrink: 0 }} />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="nome">Nome</SelectItem>
            <SelectItem value="valor_mensal">Valor Mensal</SelectItem>
            <SelectItem value="data_pagamento">Dia Pagamento</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}>
          <ArrowUpDown className="h-4 w-4" style={{ transform: sortDir === 'desc' ? 'scaleY(-1)' : undefined }} />
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center p-8"><Spinner size="lg" /></div>
      ) : (
        <div className="team-grid">
          {filtered.map(c => {
            const avatarUrl = c.id ? avatarMap[c.id] : undefined;
            const initials = getInitials(c.nome);
            return (
              <div key={c.id ?? c.nome} className="team-card card animate-up" style={{ padding: '1.25rem 1rem' }}>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  {avatarUrl ? (
                    <img src={avatarUrl} alt={initials} className="avatar" style={{ width: 44, height: 44, objectFit: 'cover', flexShrink: 0 }} />
                  ) : (
                    <div className="avatar" style={{ background: c.cor, color: '#fff', fontWeight: 700, width: 44, height: 44, fontSize: '1rem', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {initials}
                    </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <button className="client-link" onClick={() => navigate(`/clientes/${c.id}`)} style={{ fontWeight: 600, textAlign: 'left', lineHeight: 1.2 }}>
                        {c.nome}
                      </button>
                      <Badge variant={c.status === 'ativo' ? 'default' : c.status === 'pausado' ? 'secondary' : 'outline'} style={{ fontSize: '0.65rem', padding: '0 0.4rem', pointerEvents: 'none' }}>
                        {STATUS_LABEL[c.status]}
                      </Badge>
                      {c.notion_page_url && sanitizeUrl(c.notion_page_url) && (
                        <a href={sanitizeUrl(c.notion_page_url)} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', color: 'var(--text-muted)' }} title="Abrir no Notion">
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                            <path d="M4.459 4.208c.745-.303 1.25-.333 2.162-.333h13.26c.925 0 1.542.13 2.122.333l-2.003-2.189H4.153L2.164 4.208zm11.233 1.89-6.903.015L3.305 24h10.96l5.77-5.908-.008-5.32c-.006-2.133-1.077-4.137-3.08-5.419-1.258-.806-2.92-1.229-4.707-1.397L15.692 6.1zm-3.02 5.068-1.503 1.564v9.066H9.155v-8.87l-.022-1.63L12.67 11.168zm2.75-.15.42 2.973L13.88 15.645l.951-1.31-2.163.023.23-1.428-1.748-1.71h4.272z" />
                          </svg>
                        </a>
                      )}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#888', display: 'flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      {c.plano && <span>{c.plano}</span>}
                      {c.plano && c.email && <span>&bull;</span>}
                      {c.email && <span>{c.email}</span>}
                      {c.email && c.telefone && <span>&bull;</span>}
                      {c.telefone && <span>{c.telefone}</span>}
                    </div>
                  </div>

                  <div className="flex gap-1" style={{ marginLeft: 'auto' }}>
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(c)}>
                      <Edit2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                    {c.id && (
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setDeleteId(c.id!)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent onConfirmClose={() => setModalOpen(false)}>
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar Cliente' : 'Novo Cliente'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label>Nome *</Label><Input value={fNome} onChange={e => setFNome(e.target.value)} required /></div>
            <div className="space-y-1"><Label>E-mail</Label><Input type="email" value={fEmail} onChange={e => setFEmail(e.target.value)} /></div>
            <div className="space-y-1"><Label>Telefone</Label><Input value={fTelefone} onChange={e => setFTelefone(e.target.value)} /></div>
            <div className="space-y-1"><Label>Plano</Label><Input value={fPlano} onChange={e => setFPlano(e.target.value)} /></div>
            <div className="space-y-1"><Label>Valor Mensal (R$)</Label><Input type="number" min={0} step={0.01} value={fValor} onChange={e => setFValor(e.target.value)} /></div>
            <div className="space-y-1"><Label>URL do Notion</Label><Input placeholder="https://notion.so/..." value={fNotion} onChange={e => setFNotion(e.target.value)} /></div>
            <div className="space-y-1"><Label>Dia de Pagamento (1-31)</Label><Input type="number" min={1} max={31} value={fDiaPag} onChange={e => setFDiaPag(e.target.value)} /></div>
            {editing && (
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
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>{saving && <Spinner size="sm" />} Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId != null} onOpenChange={open => { if (!open) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Remover este cliente?</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Não</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Sim</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
