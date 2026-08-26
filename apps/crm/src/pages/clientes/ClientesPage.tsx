import { useState, useMemo, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  Edit2,
  Trash2,
  Upload,
  Info,
  HelpCircle,
  Search,
  ArrowUpDown,
  MoreVertical,
} from 'lucide-react';
import { openCSVSelector } from '../../lib/csv';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { UsageMeter } from '@/components/usage/UsageMeter';
import { useIsWorkspaceOwner } from '@/hooks/useIsWorkspaceOwner';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  addCliente,
  updateCliente,
  removeCliente,
  getInitials,
  type Cliente,
} from '../../store';
import { sanitizeUrl } from '../../utils/security';
import { supabase } from '../../lib/supabase';
import { useEntitlements } from '../../hooks/useEntitlements';
import { useOpenParam } from '../../hooks/useOpenParam';
import { FeatureGate } from '@/components/paywall/FeatureGate';
import { captureEvent } from '@/lib/analytics';
import { useAuth } from '../../context/AuthContext';
import { assertNoFinancialColumns, stripFinancialFields } from '@/lib/financialAccess';

type ClienteFormValues = z.infer<ReturnType<typeof createClienteSchema>>;

function createClienteSchema(t: (key: string) => string) {
  return z.object({
    nome: z.string().min(1, t('validation.nameRequired')),
    email: z.string().email(t('validation.emailInvalid')).or(z.literal('')),
    telefone: z.string(),
    plano: z.string(),
    valor: z.string(),
    notion: z.string(),
    diaPag: z
      .string()
      .refine((v) => v === '' || (Number(v) >= 1 && Number(v) <= 31), t('validation.dayRange')),
    status: z.enum(['ativo', 'pausado', 'encerrado']),
  });
}

type FilterStatus = 'todos' | 'ativo' | 'pausado' | 'encerrado';
const AVATAR_COLORS = ['#e74c3c', '#8e44ad', '#27ae60', '#2980b9', '#d35400', '#16a085'];

async function fetchAvatars(clientIds: number[]): Promise<Record<number, string>> {
  if (!clientIds.length) return {};
  const { data } = await supabase
    .from('instagram_accounts')
    .select('client_id, profile_picture_url')
    .in('client_id', clientIds)
    .not('profile_picture_url', 'is', null);
  const map: Record<number, string> = {};
  if (data)
    for (const row of data)
      if (row.client_id && row.profile_picture_url) map[row.client_id] = row.profile_picture_url;
  return map;
}

function NotionIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="currentColor"
    >
      <path d="M4.459 4.208c.745-.303 1.25-.333 2.162-.333h13.26c.925 0 1.542.13 2.122.333l-2.003-2.189H4.153L2.164 4.208zm11.233 1.89-6.903.015L3.305 24h10.96l5.77-5.908-.008-5.32c-.006-2.133-1.077-4.137-3.08-5.419-1.258-.806-2.92-1.229-4.707-1.397L15.692 6.1zm-3.02 5.068-1.503 1.564v9.066H9.155v-8.87l-.022-1.63L12.67 11.168zm2.75-.15.42 2.973L13.88 15.645l.951-1.31-2.163.023.23-1.428-1.748-1.71h4.272z" />
    </svg>
  );
}

export default function ClientesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { canSeeFinancials } = useAuth();
  const { t } = useTranslation('clients');
  const { t: tc } = useTranslation();
  const isDesktop = useIsDesktop();
  const [filter, setFilter] = useState<FilterStatus>('todos');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'nome' | 'valor_mensal' | 'data_pagamento'>('nome');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Cliente | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // The edit/add modal can hold a valor_mensal value in its form state. On
  // live revocation, close it rather than let the value linger on screen.
  useEffect(() => {
    if (canSeeFinancials !== true) setModalOpen(false);
  }, [canSeeFinancials]);

  const schema = useMemo(() => createClienteSchema(t), [t]);
  const form = useForm<ClienteFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      nome: '',
      email: '',
      telefone: '',
      plano: '',
      valor: '',
      notion: '',
      diaPag: '',
      status: 'ativo',
    },
  });

  const { isAtLimit, limits } = useEntitlements();
  const isOwner = useIsWorkspaceOwner();

  const { data: clientes = [], isLoading } = useQuery({
    queryKey: ['clientes'],
    queryFn: getClientes,
  });

  const clientsAtLimit = isAtLimit('max_clients', clientes.length);
  const { data: avatarMap = {} } = useQuery({
    queryKey: ['instagram_avatars', clientes.map((c) => c.id).join(',')],
    queryFn: () => fetchAvatars(clientes.map((c) => c.id as number).filter(Boolean)),
    enabled: clientes.length > 0,
  });

  const filtered = clientes
    .filter((c) => filter === 'todos' || c.status === filter)
    .filter(
      (c) =>
        !search ||
        c.nome.toLowerCase().includes(search.toLowerCase()) ||
        c.email?.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'nome') cmp = a.nome.localeCompare(b.nome);
      else if (sortBy === 'valor_mensal') cmp = (a.valor_mensal || 0) - (b.valor_mensal || 0);
      else if (sortBy === 'data_pagamento') cmp = (a.data_pagamento || 0) - (b.data_pagamento || 0);
      return sortDir === 'asc' ? cmp : -cmp;
    });

  const openAdd = () => {
    setEditing(null);
    form.reset({
      nome: '',
      email: '',
      telefone: '',
      plano: '',
      valor: '',
      notion: '',
      diaPag: '',
      status: 'ativo',
    });
    setModalOpen(true);
  };

  useOpenParam('novo', openAdd);

  const openEdit = (c: Cliente) => {
    setEditing(c);
    form.reset({
      nome: c.nome,
      email: c.email || '',
      telefone: c.telefone || '',
      plano: c.plano || '',
      valor: c.valor_mensal ? String(c.valor_mensal) : '',
      notion: c.notion_page_url || '',
      diaPag: c.data_pagamento ? String(c.data_pagamento) : '',
      status: c.status,
    });
    setModalOpen(true);
  };

  const onSubmit = async (values: ClienteFormValues) => {
    const diaPag = values.diaPag ? parseInt(values.diaPag, 10) : undefined;
    setSaving(true);
    try {
      if (editing?.id) {
        const payload = {
          nome: values.nome,
          email: values.email,
          telefone: values.telefone,
          plano: values.plano,
          valor_mensal: values.valor ? Number(values.valor) : 0,
          notion_page_url: values.notion,
          data_pagamento: diaPag,
          status: values.status,
        };
        await updateCliente(
          editing.id,
          stripFinancialFields(payload, canSeeFinancials, ['valor_mensal']),
        );
        toast.success(t('toast.updated'));
      } else {
        const randomColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
        const payload = {
          nome: values.nome,
          email: values.email,
          telefone: values.telefone,
          plano: values.plano,
          valor_mensal: values.valor ? Number(values.valor) : 0,
          notion_page_url: values.notion,
          data_pagamento: diaPag,
          sigla: getInitials(values.nome),
          cor: randomColor,
          status: 'ativo' as const,
        };
        await addCliente(
          stripFinancialFields(payload, canSeeFinancials, ['valor_mensal']) as Omit<
            Cliente,
            'id' | 'user_id' | 'conta_id'
          >,
        );
        toast.success(t('toast.added'));
        captureEvent('client_created');
      }
      qc.invalidateQueries({ queryKey: ['clientes'] });
      setModalOpen(false);
    } catch {
      toast.error(tc('toast.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (deleteId == null) return;
    try {
      await removeCliente(deleteId);
      toast.success(t('toast.removed'));
      qc.invalidateQueries({ queryKey: ['clientes'] });
    } catch {
      toast.error(tc('toast.deleteError'));
    }
    setDeleteId(null);
  };

  const handleCSVImport = () => {
    openCSVSelector(
      async (rows) => {
        try {
          assertNoFinancialColumns(rows, canSeeFinancials, ['valor_mensal']);
        } catch (e) {
          toast.error((e as Error).message);
          return;
        }
        let count = 0;
        for (const row of rows) {
          if (!row.nome) continue;
          try {
            const randomColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
            const rowPayload = {
              nome: row.nome,
              email: row.email || '',
              telefone: row.telefone || '',
              plano: row.plano || '',
              valor_mensal: row.valor_mensal ? Number(row.valor_mensal) : 0,
              notion_page_url: row.notion_page_url || '',
              data_pagamento: row.data_pagamento ? Number(row.data_pagamento) : undefined,
              sigla: getInitials(row.nome),
              cor: randomColor,
              status: 'ativo' as const,
            };
            await addCliente(
              stripFinancialFields(rowPayload, canSeeFinancials, ['valor_mensal']) as Omit<
                Cliente,
                'id' | 'user_id' | 'conta_id'
              >,
            );
            count++;
          } catch {
            /* skip row */
          }
        }
        toast.success(t('toast.csvImport', { count }));
        qc.invalidateQueries({ queryKey: ['clientes'] });
      },
      (err) => toast.error(err.message),
    );
  };

  return (
    <div className="page-content">
      <div className="header">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
          <div
            className="header-title"
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          >
            <h1>{t('title')}</h1>
            <span data-tooltip={t('tooltip')} data-tooltip-dir="right" style={{ display: 'flex' }}>
              <Info className="h-5 w-5 cursor-pointer" style={{ color: 'var(--text-muted)' }} />
            </span>
          </div>
          {!isLoading && limits && limits.max_clients !== null && (
            <div style={{ marginTop: 6 }}>
              <UsageMeter
                size="compact"
                label="clientes"
                used={clientes.length}
                limit={limits.max_clients}
                showUpgradeCta={isOwner}
              />
            </div>
          )}
        </div>
        <div className="header-actions">
          <span
            data-tooltip={t('csvTooltip')}
            data-tooltip-dir="bottom"
            style={{ display: 'flex' }}
          >
            <HelpCircle
              className="h-4 w-4"
              style={{ color: 'var(--text-muted)', cursor: 'pointer' }}
            />
          </span>
          <FeatureGate flag="feature_csv_import" label="Importação CSV">
            <Button variant="outline" onClick={handleCSVImport}>
              <Upload className="h-4 w-4" style={{ marginRight: '0.5rem' }} />{' '}
              {tc('actions.importCsv')}
            </Button>
          </FeatureGate>
          <Button
            onClick={openAdd}
            disabled={clientsAtLimit}
            title={clientsAtLimit ? 'Limite do plano atingido' : undefined}
          >
            <Plus className="h-4 w-4" style={{ marginRight: '0.5rem' }} /> {t('newClient')}
          </Button>
        </div>
      </div>

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
            placeholder={t('searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: '2rem' }}
          />
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {tc('filter.status')}
          </span>
          <Select value={filter} onValueChange={(v) => setFilter(v as FilterStatus)}>
            <SelectTrigger className="h-9 w-auto min-w-[120px] text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(['todos', 'ativo', 'pausado', 'encerrado'] as FilterStatus[]).map((f) => (
                <SelectItem key={f} value={f}>
                  {tc(`status.${f}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {tc('filter.sortBy')}
          </span>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
            <SelectTrigger className="h-9 w-auto min-w-[140px] text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="nome">{tc('sort.name')}</SelectItem>
              {canSeeFinancials === true && (
                <SelectItem value="valor_mensal">{t('sort.monthlyValue')}</SelectItem>
              )}
              <SelectItem value="data_pagamento">{t('sort.paymentDay')}</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0 mb-0"
            onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
            title={sortDir === 'asc' ? tc('sort.descending') : tc('sort.ascending')}
          >
            <ArrowUpDown className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center p-8">
          <Spinner size="lg" />
        </div>
      ) : isDesktop ? (
        <div className="card animate-up" style={{ padding: '0.25rem 0', overflowX: 'auto' }}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead style={{ paddingLeft: '1rem' }}>
                  {t('table.client', 'Cliente')}
                </TableHead>
                <TableHead>{t('table.contact', 'Contato')}</TableHead>
                <TableHead>{t('form.plan')}</TableHead>
                <TableHead>{t('table.status', 'Status')}</TableHead>
                <TableHead style={{ width: 56 }} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => {
                const avatarUrl = c.id ? avatarMap[c.id] : undefined;
                const initials = getInitials(c.nome);
                const notionUrl = c.notion_page_url ? sanitizeUrl(c.notion_page_url) : '';
                return (
                  <TableRow
                    key={c.id ?? c.nome}
                    onClick={() => c.id && navigate(`/clientes/${c.id}`)}
                    style={{ cursor: 'pointer' }}
                  >
                    <TableCell style={{ paddingLeft: '1rem' }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.6rem',
                          minWidth: 0,
                        }}
                      >
                        {avatarUrl ? (
                          <img
                            src={avatarUrl}
                            alt={initials}
                            className="avatar"
                            style={{ width: 28, height: 28, objectFit: 'cover', flexShrink: 0 }}
                          />
                        ) : (
                          <div
                            className="avatar"
                            style={{
                              width: 28,
                              height: 28,
                              fontSize: '0.7rem',
                              background: c.cor,
                              color: '#fff',
                              fontWeight: 700,
                              flexShrink: 0,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            {initials}
                          </div>
                        )}
                        <button
                          className="client-link"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/clientes/${c.id}`);
                          }}
                          style={{ fontWeight: 600, textAlign: 'left' }}
                        >
                          {c.nome}
                        </button>
                        {notionUrl && (
                          <a
                            href={notionUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              color: 'var(--text-muted)',
                            }}
                            title={t('openNotion')}
                          >
                            <NotionIcon />
                          </a>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="contato-item">{c.email || '—'}</span>
                      {c.telefone && <span className="contato-phone">{c.telefone}</span>}
                    </TableCell>
                    <TableCell>{c.plano || '—'}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          c.status === 'ativo'
                            ? 'success'
                            : c.status === 'pausado'
                              ? 'warning'
                              : 'neutral'
                        }
                        size="sm"
                        style={{ pointerEvents: 'none' }}
                      >
                        {tc(`status.${c.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell
                      onClick={(e) => e.stopPropagation()}
                      style={{ paddingRight: '0.75rem', textAlign: 'right' }}
                    >
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0">
                            <MoreVertical className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(c)}>
                            <Edit2 className="h-4 w-4 mr-2" />
                            {tc('actions.edit')}
                          </DropdownMenuItem>
                          {c.id && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => setDeleteId(c.id!)}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                {tc('actions.delete')}
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}
                  >
                    {t('emptyList', 'Nenhum cliente encontrado.')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="team-grid">
          {filtered.map((c) => {
            const avatarUrl = c.id ? avatarMap[c.id] : undefined;
            const initials = getInitials(c.nome);
            return (
              <div key={c.id ?? c.nome} className="team-card card animate-up">
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={initials}
                      className="avatar client-avatar"
                      style={{ objectFit: 'cover', flexShrink: 0 }}
                    />
                  ) : (
                    <div
                      className="avatar client-avatar"
                      style={{
                        background: c.cor,
                        color: '#fff',
                        fontWeight: 700,
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {initials}
                    </div>
                  )}
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.15rem',
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        flexWrap: 'wrap',
                      }}
                    >
                      <button
                        className="client-link"
                        onClick={() => navigate(`/clientes/${c.id}`)}
                        style={{ fontWeight: 600, textAlign: 'left', lineHeight: 1.2 }}
                      >
                        {c.nome}
                      </button>
                      <Badge
                        variant={
                          c.status === 'ativo'
                            ? 'success'
                            : c.status === 'pausado'
                              ? 'warning'
                              : 'neutral'
                        }
                        size="sm"
                        style={{ pointerEvents: 'none' }}
                      >
                        {tc(`status.${c.status}`)}
                      </Badge>
                      {c.notion_page_url && sanitizeUrl(c.notion_page_url) && (
                        <a
                          href={sanitizeUrl(c.notion_page_url)}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            color: 'var(--text-muted)',
                          }}
                          title={t('openNotion')}
                        >
                          <NotionIcon />
                        </a>
                      )}
                    </div>
                    {c.plano && <div style={{ fontSize: '0.75rem', color: '#888' }}>{c.plano}</div>}
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 shrink-0"
                        style={{ marginLeft: 'auto' }}
                      >
                        <MoreVertical className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEdit(c)}>
                        <Edit2 className="h-4 w-4 mr-2" />
                        {tc('actions.edit')}
                      </DropdownMenuItem>
                      {c.id && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => setDeleteId(c.id!)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            {tc('actions.delete')}
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent onConfirmClose={() => setModalOpen(false)}>
          <DialogHeader>
            <DialogTitle>{editing ? t('dialog.editTitle') : t('dialog.newTitle')}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
              <FormField
                control={form.control}
                name="nome"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('form.name')}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('form.email')}</FormLabel>
                    <FormControl>
                      <Input type="email" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="telefone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('form.phone')}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="plano"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('form.plan')}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {canSeeFinancials === true && (
                <FormField
                  control={form.control}
                  name="valor"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('form.monthlyValue')}</FormLabel>
                      <FormControl>
                        <Input type="number" min={0} step={0.01} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              <FormField
                control={form.control}
                name="notion"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('form.notionUrl')}</FormLabel>
                    <FormControl>
                      <Input placeholder="https://notion.so/..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="diaPag"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('form.paymentDay')}</FormLabel>
                    <FormControl>
                      <Input type="number" min={1} max={31} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {editing && (
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('form.status')}</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="ativo">{tc('status.ativo')}</SelectItem>
                          <SelectItem value="pausado">{tc('status.pausado')}</SelectItem>
                          <SelectItem value="encerrado">{tc('status.encerrado')}</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
                  {tc('actions.cancel')}
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving && <Spinner size="sm" />} {tc('actions.save')}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteId != null}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteConfirm')}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc('actions.no')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>{tc('actions.yes')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
