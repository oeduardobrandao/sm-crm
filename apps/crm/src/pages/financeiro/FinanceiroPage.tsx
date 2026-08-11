import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus,
  Edit2,
  Trash2,
  Check,
  Upload,
  Info,
  HelpCircle,
  Search,
  MoreVertical,
  CheckCircle2,
  ArrowDownCircle,
  ArrowUpCircle,
  Wallet,
  TrendingUp,
} from 'lucide-react';
import { StatCard } from '@/components/StatCard';
import { StatCardGrid } from '@/components/StatCardGrid';
import { openCSVSelector } from '../../lib/csv';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { HelpTooltip } from '@/components/help/HelpTooltip';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MonthPicker } from '@/components/ui/month-picker';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  getClientes,
  getMembros,
  getTransacoes,
  projetarAgendamentos,
  addTransacao,
  updateTransacao,
  removeTransacao,
  formatDate,
  type Transacao,
} from '../../store';
import { useAuth } from '../../context/AuthContext';
import { handleEntitlementMutationError } from '@/lib/entitlement-toast';
import { formatFinancialBRL } from '@/lib/financialAccess';

const CATEGORIAS = [
  'Mensalidade',
  'Produção',
  'Tráfego',
  'Salário',
  'Imposto',
  'Ferramenta',
  'Outro',
];
type FilterType = 'todas' | 'entradas' | 'saidas';

const transacaoSchema = z.object({
  descricao: z.string().min(1, 'Descrição obrigatória'),
  valor: z
    .string()
    .min(1, 'Valor obrigatório')
    .refine((v) => Number(v) > 0, 'Valor deve ser positivo'),
  data: z.string().min(1, 'Data obrigatória'),
  categoria: z.string().min(1, 'Categoria obrigatória'),
});
type TransacaoFormValues = z.infer<typeof transacaoSchema>;

function isoToDate(iso: string): Date | undefined {
  if (!iso) return undefined;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

function dateToIso(date: Date | undefined): string {
  if (!date) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Projected occurrences get a NEW random id on every render (computed.ts), so
// selection must key on referencia_agendamento — the only stable identity.
const rowKey = (t: Transacao) =>
  t.referencia_agendamento ? `proj-${t.referencia_agendamento}` : `id-${t.id}`;

export default function FinanceiroPage() {
  const { canSeeFinancials, profile } = useAuth();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<FilterType>('todas');
  const [search, setSearch] = useState('');
  const [monthFilter, setMonthFilter] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTipo, setModalTipo] = useState<'entrada' | 'saida'>('entrada');
  const [editing, setEditing] = useState<Transacao | null>(null);
  const [confirmT, setConfirmT] = useState<Transacao | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const form = useForm<TransacaoFormValues>({
    resolver: zodResolver(transacaoSchema),
    defaultValues: { descricao: '', valor: '', data: '', categoria: '' },
  });

  const { data: clientes = [] } = useQuery({ queryKey: ['clientes'], queryFn: getClientes });
  const { data: membros = [] } = useQuery({ queryKey: ['membros'], queryFn: getMembros });
  const { data: transacoesFisicas = [], isLoading } = useQuery({
    queryKey: ['transacoes'],
    queryFn: getTransacoes,
  });

  const projected = projetarAgendamentos(transacoesFisicas, clientes, membros, canSeeFinancials);
  const allTransacoes = projected.filter((t) => !monthFilter || t.data.startsWith(monthFilter));

  const recebido = allTransacoes
    .filter((t) => t.tipo === 'entrada' && t.status === 'pago')
    .reduce((s, t) => s + t.valor, 0);
  const aReceber = allTransacoes
    .filter((t) => t.tipo === 'entrada' && t.status === 'agendado')
    .reduce((s, t) => s + t.valor, 0);
  const aPagar = allTransacoes
    .filter((t) => t.tipo === 'saida' && t.status === 'agendado')
    .reduce((s, t) => s + t.valor, 0);
  const saldoAtual =
    recebido -
    allTransacoes
      .filter((t) => t.tipo === 'saida' && t.status === 'pago')
      .reduce((s, t) => s + t.valor, 0);
  const saldoProjetado = saldoAtual + aReceber - aPagar;

  const filtered = allTransacoes
    .filter((t) => {
      if (filter === 'entradas') return t.tipo === 'entrada';
      if (filter === 'saidas') return t.tipo === 'saida';
      return true;
    })
    .filter(
      (t) =>
        !search ||
        t.descricao.toLowerCase().includes(search.toLowerCase()) ||
        t.categoria?.toLowerCase().includes(search.toLowerCase()),
    );

  const agendadas = filtered.filter((t) => t.status === 'agendado');
  const selecionadas = agendadas.filter((t) => selectedKeys.has(rowKey(t)));
  const allSelected = agendadas.length > 0 && selecionadas.length === agendadas.length;

  const toggleAll = () => {
    setSelectedKeys(allSelected ? new Set() : new Set(agendadas.map(rowKey)));
  };
  const toggleOne = (t: Transacao) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      const k = rowKey(t);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const openAdd = (tipo: 'entrada' | 'saida') => {
    setEditing(null);
    setModalTipo(tipo);
    form.reset({ descricao: '', valor: '', data: '', categoria: '' });
    setModalOpen(true);
  };

  const openEdit = (t: Transacao) => {
    setEditing(t);
    setModalTipo(t.tipo);
    form.reset({
      descricao: t.descricao,
      valor: String(t.valor),
      data: t.data,
      categoria: t.categoria || '',
    });
    setModalOpen(true);
  };

  const onSubmit = async (values: TransacaoFormValues) => {
    setSaving(true);
    try {
      const payload: Omit<Transacao, 'id' | 'user_id' | 'conta_id'> = {
        descricao: values.descricao,
        detalhe: '',
        valor: Number(values.valor),
        data: values.data,
        categoria: values.categoria,
        tipo: modalTipo,
        status: 'pago',
      };
      if (editing?.id) {
        await updateTransacao(editing.id, payload);
        toast.success('Transação atualizada');
      } else {
        await addTransacao(payload);
        toast.success('Transação registrada');
      }
      qc.invalidateQueries({ queryKey: ['transacoes'] });
      setModalOpen(false);
    } catch (e) {
      // trg_feature_financial gates `transacoes` at the database, on a direct
      // client write: no edge function in the path, and store.ts is not a
      // TanStack mutation, so App.tsx's MutationCache.onError never sees it.
      // This catch is the only observation point for feature_financial.
      // handleEntitlementMutationError shows the upgrade toast itself; only
      // fall through to the generic one when it declines.
      if (!handleEntitlementMutationError(e, profile?.conta_id ?? null))
        toast.error('Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  // Scheduled rows with an id are updated in place; projected occurrences
  // (referencia_agendamento) are materialized as a new paid row.
  const confirmOne = async (t: Transacao) => {
    if (t.id && !t.referencia_agendamento) {
      await updateTransacao(t.id, { status: 'pago' });
    } else {
      const { id, user_id, conta_id, ...rest } = t;
      await addTransacao({ ...rest, status: 'pago' });
    }
  };

  const handleConfirmPago = async () => {
    if (!confirmT) return;
    try {
      await confirmOne(confirmT);
      toast.success('Pagamento confirmado');
      qc.invalidateQueries({ queryKey: ['transacoes'] });
    } catch {
      toast.error('Erro ao confirmar pagamento');
    }
    setConfirmT(null);
  };

  const handleBulkConfirm = async () => {
    const pendentes = filtered.filter(
      (t) => t.status === 'agendado' && selectedKeys.has(rowKey(t)),
    );
    let ok = 0;
    let fail = 0;
    for (const t of pendentes) {
      try {
        await confirmOne(t);
        ok++;
      } catch {
        fail++;
      }
    }
    if (ok > 0) toast.success(ok === 1 ? '1 pagamento confirmado' : `${ok} pagamentos confirmados`);
    if (fail > 0)
      toast.error(
        `${fail} não ${fail === 1 ? 'pôde' : 'puderam'} ser confirmado${fail === 1 ? '' : 's'}`,
      );
    qc.invalidateQueries({ queryKey: ['transacoes'] });
    setSelectedKeys(new Set());
    setBulkConfirmOpen(false);
  };

  const handleDelete = async () => {
    if (deleteId == null) return;
    try {
      await removeTransacao(deleteId);
      toast.success('Transação removida');
      qc.invalidateQueries({ queryKey: ['transacoes'] });
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
          if (!row.descricao || !row.valor || !row.data) continue;
          try {
            const tipo = (row.tipo === 'saida' ? 'saida' : 'entrada') as Transacao['tipo'];
            await addTransacao({
              descricao: row.descricao,
              detalhe: row.detalhe || '',
              valor: Number(row.valor),
              data: row.data,
              categoria: row.categoria || '',
              tipo,
              status: 'pago',
            });
            count++;
          } catch {
            /* skip row */
          }
        }
        toast.success(
          `${count} transação${count !== 1 ? 'ões' : ''} importada${count !== 1 ? 's' : ''} com sucesso!`,
        );
        qc.invalidateQueries({ queryKey: ['transacoes'] });
      },
      (err) => toast.error(err.message),
    );
  };

  return (
    <div className="page-content">
      <div className="header">
        <div
          className="header-title"
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <h1>Financeiro</h1>
          <span
            data-tooltip="Visão das finanças, receitas projetadas e despesas."
            data-tooltip-dir="right"
            style={{ display: 'flex' }}
          >
            <Info className="h-5 w-5 cursor-pointer" style={{ color: 'var(--text-muted)' }} />
          </span>
        </div>
        <div className="header-actions">
          <HelpTooltip
            content={
              <div className="space-y-1.5">
                <p>
                  <strong>Colunas CSV:</strong> descricao*, valor*, data* (AAAA-MM-DD), tipo
                  (entrada|saida), categoria, detalhe
                </p>
                <p>
                  <strong>Categorias válidas:</strong> Mensalidade, Produção, Tráfego, Salário,
                  Imposto, Ferramenta, Outro
                </p>
              </div>
            }
          >
            <span style={{ display: 'flex' }}>
              <HelpCircle
                className="h-4 w-4"
                style={{ color: 'var(--text-muted)', cursor: 'pointer' }}
              />
            </span>
          </HelpTooltip>
          <Button
            variant="outline"
            size="icon"
            onClick={handleCSVImport}
            className="header-actions-icon-only"
          >
            <Upload className="h-4 w-4" />
          </Button>
          <Button variant="outline" onClick={handleCSVImport} className="header-actions-full-only">
            <Upload className="h-4 w-4" style={{ marginRight: '0.5rem' }} /> Importar CSV
          </Button>
          <Button onClick={() => openAdd('entrada')}>
            <Plus className="h-4 w-4" style={{ marginRight: '0.5rem' }} /> Entrada
          </Button>
          <Button variant="outline" onClick={() => openAdd('saida')}>
            <Plus className="h-4 w-4" style={{ marginRight: '0.5rem' }} /> Saída
          </Button>
        </div>
      </div>

      <StatCardGrid style={{ marginBottom: '1.5rem' }}>
        {(
          [
            {
              label: 'Recebido',
              value: formatFinancialBRL(recebido, canSeeFinancials),
              icon: CheckCircle2,
              tone: 'green' as const,
            },
            {
              label: 'A receber',
              value: formatFinancialBRL(aReceber, canSeeFinancials),
              icon: ArrowDownCircle,
              tone: 'amber' as const,
            },
            {
              label: 'A pagar',
              value: formatFinancialBRL(aPagar, canSeeFinancials),
              icon: ArrowUpCircle,
              tone: 'red' as const,
            },
            {
              label: 'Saldo atual',
              value: formatFinancialBRL(saldoAtual, canSeeFinancials),
              icon: Wallet,
              tone: saldoAtual >= 0 ? ('green' as const) : ('red' as const),
            },
            {
              label: 'Saldo projetado',
              value: formatFinancialBRL(saldoProjetado, canSeeFinancials),
              icon: TrendingUp,
              tone: saldoProjetado >= 0 ? ('green' as const) : ('red' as const),
            },
          ] as const
        ).map((kpi) => (
          <StatCard
            key={kpi.label}
            label={kpi.label}
            value={kpi.value}
            icon={kpi.icon}
            tone={kpi.tone}
            compactValue
          />
        ))}
      </StatCardGrid>

      <div
        style={{
          display: 'flex',
          gap: '0.75rem',
          marginBottom: '1rem',
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ position: 'relative', width: '100%', maxWidth: '260px' }}>
          <Search
            className="h-4 w-4"
            style={{
              position: 'absolute',
              left: '0.625rem',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-muted)',
              pointerEvents: 'none',
            }}
          />
          <Input
            className="h-9"
            placeholder="Buscar por descrição ou categoria..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: '2rem' }}
          />
        </div>
        <MonthPicker
          value={monthFilter}
          onChange={setMonthFilter}
          className="rounded-full text-xs px-4 mb-0 shrink-0"
        />
        <Select value={filter} onValueChange={(v) => setFilter(v as FilterType)}>
          <SelectTrigger className="h-9 w-auto min-w-[130px] rounded-full text-xs px-4 mb-0 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas</SelectItem>
            <SelectItem value="entradas">Entradas</SelectItem>
            <SelectItem value="saidas">Saídas</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex justify-center p-8">
          <Spinner size="lg" />
        </div>
      ) : (
        <>
          {/* Desktop table */}
          {selecionadas.length > 0 && (
            <div
              className="financeiro-desktop-table"
              style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.75rem' }}
            >
              <Button onClick={() => setBulkConfirmOpen(true)}>
                <Check className="h-3 w-3" /> Confirmar selecionadas ({selecionadas.length})
              </Button>
            </div>
          )}
          <div className="card financeiro-desktop-table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead style={{ width: 36, paddingLeft: '0.75rem' }}>
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={toggleAll}
                      disabled={agendadas.length === 0}
                      aria-label="Selecionar todas as agendadas"
                    />
                  </TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((t, i) => (
                  <TableRow key={t.id ?? `proj-${i}`}>
                    <TableCell style={{ paddingLeft: '0.75rem' }}>
                      {t.status === 'agendado' && (
                        <Checkbox
                          checked={selectedKeys.has(rowKey(t))}
                          onCheckedChange={() => toggleOne(t)}
                          aria-label="Selecionar transação"
                        />
                      )}
                    </TableCell>
                    <TableCell data-label="Data">{formatDate(t.data)}</TableCell>
                    <TableCell data-label="Descrição">
                      <div>{t.descricao}</div>
                      {t.detalhe && <div style={{ fontSize: 12, color: '#888' }}>{t.detalhe}</div>}
                    </TableCell>
                    <TableCell data-label="Categoria">{t.categoria}</TableCell>
                    <TableCell data-label="Valor">
                      <span
                        style={{
                          color: t.tipo === 'entrada' ? '#3ecf8e' : '#ef4444',
                          fontWeight: 600,
                        }}
                      >
                        {t.tipo === 'entrada' ? '+' : '-'}
                        {formatFinancialBRL(t.valor, canSeeFinancials)}
                      </span>
                    </TableCell>
                    <TableCell data-label="Status">
                      <Badge variant={t.status === 'pago' ? 'success' : 'neutral'}>
                        {t.status === 'pago' ? 'Pago' : 'Agendado'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1" style={{ justifyContent: 'flex-end' }}>
                        {t.status === 'agendado' ? (
                          <Button size="sm" variant="outline" onClick={() => setConfirmT(t)}>
                            <Check className="h-3 w-3" /> Confirmar
                          </Button>
                        ) : (
                          <>
                            <Button size="icon" variant="ghost" onClick={() => openEdit(t)}>
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            {t.id && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="text-destructive"
                                onClick={() => setDeleteId(t.id!)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <div className="financeiro-mobile-cards">
            {filtered.map((t, i) => (
              <div key={t.id ?? `proj-${i}`} className="team-card card animate-up">
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        flexWrap: 'wrap',
                      }}
                    >
                      <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{t.descricao}</span>
                      <Badge
                        variant={t.status === 'pago' ? 'success' : 'neutral'}
                        size="sm"
                        style={{ pointerEvents: 'none' }}
                      >
                        {t.status === 'pago' ? 'Pago' : 'Agendado'}
                      </Badge>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        flexWrap: 'wrap',
                        marginTop: 2,
                      }}
                    >
                      <span
                        style={{
                          color: t.tipo === 'entrada' ? '#3ecf8e' : '#ef4444',
                          fontWeight: 600,
                          fontSize: '0.85rem',
                        }}
                      >
                        {t.tipo === 'entrada' ? '+' : '-'}
                        {formatFinancialBRL(t.valor, canSeeFinancials)}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: '#888' }}>&bull;</span>
                      <span style={{ fontSize: '0.75rem', color: '#888' }}>
                        {formatDate(t.data)}
                      </span>
                      {t.categoria && (
                        <>
                          <span style={{ fontSize: '0.75rem', color: '#888' }}>&bull;</span>
                          <span style={{ fontSize: '0.75rem', color: '#888' }}>{t.categoria}</span>
                        </>
                      )}
                    </div>
                  </div>
                  {t.status === 'agendado' ? (
                    <Button size="sm" className="shrink-0 mb-0" onClick={() => setConfirmT(t)}>
                      <Check className="h-3 w-3" />
                    </Button>
                  ) : (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 mb-0">
                          <MoreVertical className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(t)}>
                          <Edit2 className="h-4 w-4 mr-2" />
                          Editar
                        </DropdownMenuItem>
                        {t.id && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => setDeleteId(t.id!)}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Remover
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Modal de edição/criação */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent onConfirmClose={() => setModalOpen(false)}>
          <DialogHeader>
            <DialogTitle>
              {editing
                ? 'Editar Transação'
                : modalTipo === 'entrada'
                  ? 'Registrar Entrada'
                  : 'Registrar Saída'}
            </DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="descricao"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descrição</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="valor"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Valor (R$)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        step={0.01}
                        {...field}
                        value={field.value ?? ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="data"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Data</FormLabel>
                    <FormControl>
                      <DatePicker
                        value={isoToDate(field.value)}
                        onChange={(d) => field.onChange(dateToIso(d))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="categoria"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Categoria</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione..." />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {CATEGORIAS.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving && <Spinner size="sm" />}
                  Salvar
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Confirmar pagamento */}
      <AlertDialog
        open={!!confirmT}
        onOpenChange={(open) => {
          if (!open) setConfirmT(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar pagamento?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Não</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmPago}>Sim</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmar pagamentos em lote */}
      <AlertDialog
        open={bulkConfirmOpen}
        onOpenChange={(open) => {
          if (!open) setBulkConfirmOpen(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {selecionadas.length === 1
                ? 'Confirmar 1 pagamento?'
                : `Confirmar ${selecionadas.length} pagamentos?`}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Não</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkConfirm}>Sim</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmar exclusão */}
      <AlertDialog
        open={deleteId != null}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover esta transação?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Não</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Sim</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
