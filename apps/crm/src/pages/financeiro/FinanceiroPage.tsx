import { useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useForm, useWatch } from 'react-hook-form';
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
  Repeat,
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
import { CardListSkeleton, TableSkeleton } from '@/components/ui/skeletons';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { usePhoneLayout } from '@/components/layout/PhoneLayoutContext';
import { usePageToolbar } from '@/components/layout/PageToolbarContext';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import { FormRow } from '@/components/mobile/FormRow';
import { PickerCell } from '@/components/mobile/PickerSheet';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { FinanceiroPhone } from './phone/FinanceiroPhone';
import { RecorrentesDialog } from './RecorrentesDialog';
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
  getRecorrentes,
  addRecorrente,
  referenciaRecorrente,
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

// Stored in transacoes.categoria as is, so these stay Portuguese in every UI language.
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

function createTransacaoSchema(t: (key: string) => string) {
  return z.object({
    descricao: z.string().min(1, t('form.errors.descriptionRequired')),
    valor: z
      .string()
      .min(1, t('form.errors.amountRequired'))
      .refine((v) => Number(v) > 0, t('form.errors.amountPositive')),
    data: z.string().min(1, t('form.errors.dateRequired')),
    categoria: z.string().min(1, t('form.errors.categoryRequired')),
  });
}
type TransacaoFormValues = z.infer<ReturnType<typeof createTransacaoSchema>>;

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
  const { t } = useTranslation('finance');
  const transacaoSchema = useMemo(() => createTransacaoSchema(t), [t]);
  // Same 900px split as the .financeiro-desktop-table / .financeiro-mobile-cards CSS below, so the
  // skeleton takes the shape of whichever layout is about to render.
  const isDesktop = useIsDesktop(901);
  // Below 768px the page is the phone list (PLAN F2d); 768-900 keeps the cards above.
  const isPhone = !useIsDesktop(768);
  // The form body follows the dialog primitive, which turns into a sheet only inside the
  // phone shell (PhoneLayoutContext), so a dialog rendered elsewhere keeps its fields.
  const { isPhone: phoneForm } = usePhoneLayout();
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
  // "Repetir todo mês" on a new lançamento.
  const [recorrente, setRecorrente] = useState(false);
  const [recorrentesOpen, setRecorrentesOpen] = useState(false);
  // Phone bulk-confirm mode ("Selecionar"). Leaving it drops the selection.
  const [phoneSelecting, setPhoneSelectingState] = useState(false);
  const setPhoneSelecting = (next: boolean) => {
    setPhoneSelectingState(next);
    if (!next) setSelectedKeys(new Set());
  };

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

  const { data: recorrentes = [] } = useQuery({
    queryKey: ['transacoes-recorrentes'],
    queryFn: getRecorrentes,
    enabled: canSeeFinancials === true,
  });

  const projected = projetarAgendamentos(
    transacoesFisicas,
    clientes,
    membros,
    canSeeFinancials,
    recorrentes,
  );
  const allTransacoes = projected.filter((tr) => !monthFilter || tr.data.startsWith(monthFilter));

  const recebido = allTransacoes
    .filter((tr) => tr.tipo === 'entrada' && tr.status === 'pago')
    .reduce((s, tr) => s + tr.valor, 0);
  const aReceber = allTransacoes
    .filter((tr) => tr.tipo === 'entrada' && tr.status === 'agendado')
    .reduce((s, tr) => s + tr.valor, 0);
  const aPagar = allTransacoes
    .filter((tr) => tr.tipo === 'saida' && tr.status === 'agendado')
    .reduce((s, tr) => s + tr.valor, 0);
  const saldoAtual =
    recebido -
    allTransacoes
      .filter((tr) => tr.tipo === 'saida' && tr.status === 'pago')
      .reduce((s, tr) => s + tr.valor, 0);
  const saldoProjetado = saldoAtual + aReceber - aPagar;

  const filtered = allTransacoes
    .filter((tr) => {
      if (filter === 'entradas') return tr.tipo === 'entrada';
      if (filter === 'saidas') return tr.tipo === 'saida';
      return true;
    })
    .filter(
      (tr) =>
        !search ||
        tr.descricao.toLowerCase().includes(search.toLowerCase()) ||
        tr.categoria?.toLowerCase().includes(search.toLowerCase()),
    );

  const agendadas = filtered.filter((tr) => tr.status === 'agendado');
  const selecionadas = agendadas.filter((tr) => selectedKeys.has(rowKey(tr)));
  const allSelected = agendadas.length > 0 && selecionadas.length === agendadas.length;

  const toggleAll = () => {
    setSelectedKeys(allSelected ? new Set() : new Set(agendadas.map(rowKey)));
  };
  const toggleOne = (tr: Transacao) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      const k = rowKey(tr);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const openAdd = (tipo: 'entrada' | 'saida') => {
    setEditing(null);
    setModalTipo(tipo);
    setRecorrente(false);
    form.reset({ descricao: '', valor: '', data: '', categoria: '' });
    setModalOpen(true);
  };

  const openEdit = (tr: Transacao) => {
    setEditing(tr);
    setModalTipo(tr.tipo);
    form.reset({
      descricao: tr.descricao,
      valor: String(tr.valor),
      data: tr.data,
      categoria: tr.categoria || '',
    });
    setModalOpen(true);
  };

  const onSubmit = async (values: TransacaoFormValues) => {
    setSaving(true);
    try {
      const payload: Omit<Transacao, 'id' | 'user_id' | 'conta_id'> = {
        descricao: values.descricao,
        // Keeps "Recorrente" (or an imported detalhe) on an edited row.
        detalhe: editing?.detalhe ?? '',
        valor: Number(values.valor),
        data: values.data,
        categoria: values.categoria,
        tipo: modalTipo,
        status: 'pago',
      };
      if (editing?.id) {
        await updateTransacao(editing.id, payload);
        toast.success(t('page.toasts.updated'));
      } else if (recorrente) {
        // The template starts in the month of the chosen date, and this lançamento is that
        // month's occurrence, so the month is not projected again as agendado.
        const [ano, mes, dia] = values.data.split('-').map(Number);
        const r = await addRecorrente({
          tipo: modalTipo,
          descricao: values.descricao.trim(),
          categoria: values.categoria,
          valor: Number(values.valor),
          dia,
          inicio: `${values.data.slice(0, 7)}-01`,
        });
        await addTransacao({
          ...payload,
          // Saved to the database, so it stays Portuguese.
          detalhe: 'Recorrente',
          referencia_agendamento: referenciaRecorrente(r.id!, ano, mes),
        });
        toast.success(t('page.toasts.createdRecurring'));
        qc.invalidateQueries({ queryKey: ['transacoes-recorrentes'] });
      } else {
        await addTransacao(payload);
        toast.success(t('page.toasts.created'));
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
        toast.error(t('toast.saveError'));
    } finally {
      setSaving(false);
    }
  };

  // Scheduled rows with an id are updated in place; projected occurrences
  // (referencia_agendamento) are materialized as a new paid row.
  const confirmOne = async (tr: Transacao) => {
    if (tr.id && !tr.referencia_agendamento) {
      await updateTransacao(tr.id, { status: 'pago' });
    } else {
      const { id, user_id, conta_id, ...rest } = tr;
      await addTransacao({ ...rest, status: 'pago' });
    }
  };

  const handleConfirmPago = async () => {
    if (!confirmT) return;
    try {
      await confirmOne(confirmT);
      toast.success(t('page.toasts.paymentConfirmed'));
      qc.invalidateQueries({ queryKey: ['transacoes'] });
    } catch {
      toast.error(t('page.toasts.confirmError'));
    }
    setConfirmT(null);
  };

  const handleBulkConfirm = async () => {
    const pendentes = filtered.filter(
      (tr) => tr.status === 'agendado' && selectedKeys.has(rowKey(tr)),
    );
    let ok = 0;
    let fail = 0;
    for (const tr of pendentes) {
      try {
        await confirmOne(tr);
        ok++;
      } catch {
        fail++;
      }
    }
    if (ok > 0) toast.success(t('page.toasts.bulkConfirmed', { count: ok }));
    if (fail > 0) toast.error(t('page.toasts.bulkFailed', { count: fail }));
    qc.invalidateQueries({ queryKey: ['transacoes'] });
    setSelectedKeys(new Set());
    setBulkConfirmOpen(false);
    // Runs after the awaited writes, so the confirm dialog closed long before.
    setPhoneSelectingState(false);
  };

  const handleDelete = async () => {
    if (deleteId == null) return;
    try {
      await removeTransacao(deleteId);
      toast.success(t('page.toasts.removed'));
      qc.invalidateQueries({ queryKey: ['transacoes'] });
    } catch {
      toast.error(t('toast.deleteError'));
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
        toast.success(t('page.toasts.imported', { count }));
        qc.invalidateQueries({ queryKey: ['transacoes'] });
      },
      (err) => toast.error(err.message),
    );
  };

  const categoria = useWatch({ control: form.control, name: 'categoria' });
  const { errors } = form.formState;
  // FTransacaoForm: grouped rows, a native date control and a checkmark list for Categoria.
  const phoneFields = (
    <>
      <GroupedList aria-label={t('form.groupLabel')}>
        <FormRow
          label={t('form.description')}
          error={errors.descricao?.message}
          input={{ ...form.register('descricao'), autoComplete: 'off' }}
        />
        <FormRow
          label={t('form.amount')}
          error={errors.valor?.message}
          input={{
            ...form.register('valor'),
            type: 'number',
            inputMode: 'decimal',
            min: 0,
            step: 0.01,
            placeholder: '0,00',
          }}
        />
        <FormRow label={t('form.date')} error={errors.data?.message}>
          {(field) => (
            <input
              {...field}
              {...form.register('data')}
              type="date"
              className="phone-form-row__input"
            />
          )}
        </FormRow>
      </GroupedList>
      <GroupedList footer={errors.categoria?.message}>
        <PickerCell
          label={t('form.category')}
          placeholder={t('form.selectPlaceholder')}
          options={CATEGORIAS.map((c) => ({ value: c, label: c }))}
          value={categoria || null}
          onChange={(v) =>
            form.setValue('categoria', v ?? '', {
              shouldDirty: true,
              shouldValidate: form.formState.isSubmitted,
            })
          }
        />
      </GroupedList>
      {!editing && (
        <GroupedList footer={t('shared.repeatMonthlyHint')}>
          <Cell
            label={t('shared.repeatMonthly')}
            switch={{ checked: recorrente, onCheckedChange: setRecorrente }}
          />
        </GroupedList>
      )}
    </>
  );

  const dialogs = (
    <>
      {/* Modal de edição/criação */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent onConfirmClose={() => setModalOpen(false)}>
          <DialogHeader>
            <DialogTitle>
              {editing
                ? t('page.editTitle')
                : modalTipo === 'entrada'
                  ? t('page.addIncomeTitle')
                  : t('page.addExpenseTitle')}
            </DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              {phoneForm ? (
                phoneFields
              ) : (
                <>
                  <FormField
                    control={form.control}
                    name="descricao"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('form.description')}</FormLabel>
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
                        <FormLabel>{t('form.amount')}</FormLabel>
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
                        <FormLabel>{t('form.date')}</FormLabel>
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
                        <FormLabel>{t('form.category')}</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder={t('form.selectPlaceholder')} />
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
                  {!editing && (
                    <div className="flex items-start gap-3">
                      <Switch
                        id="transacao-recorrente"
                        checked={recorrente}
                        onCheckedChange={setRecorrente}
                        className="mt-0.5"
                      />
                      <div className="flex flex-col gap-0.5">
                        <Label htmlFor="transacao-recorrente">{t('shared.repeatMonthly')}</Label>
                        <span className="text-xs text-muted-foreground">
                          {t('shared.repeatMonthlyHint')}
                        </span>
                      </div>
                    </div>
                  )}
                </>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
                  {t('actions.cancel')}
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving && <Spinner size="sm" />}
                  {t('actions.save')}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <RecorrentesDialog
        open={recorrentesOpen}
        onOpenChange={setRecorrentesOpen}
        recorrentes={recorrentes}
        categorias={CATEGORIAS}
        access={canSeeFinancials}
        onChanged={() => qc.invalidateQueries({ queryKey: ['transacoes-recorrentes'] })}
      />

      {/* Confirmar pagamento */}
      <AlertDialog
        open={!!confirmT}
        onOpenChange={(open) => {
          if (!open) setConfirmT(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('page.confirmPaymentTitle')}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.no')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmPago}>{t('actions.yes')}</AlertDialogAction>
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
              {t('page.bulkConfirmTitle', { count: selecionadas.length })}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.no')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkConfirm}>{t('actions.yes')}</AlertDialogAction>
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
            <AlertDialogTitle>{t('page.deleteTitle')}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.no')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>{t('actions.yes')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  const infoTooltip = (
    <span
      data-tooltip={t('shared.description')}
      data-tooltip-dir="right"
      style={{ display: 'flex' }}
    >
      <Info className="h-5 w-5 cursor-pointer" style={{ color: 'var(--text-muted)' }} />
    </span>
  );
  const csvActions = (
    <>
      {canSeeFinancials === true && (
        <>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setRecorrentesOpen(true)}
            className="header-actions-icon-only"
            aria-label={t('shared.recurring')}
          >
            <Repeat className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            onClick={() => setRecorrentesOpen(true)}
            className="header-actions-full-only"
          >
            <Repeat className="h-4 w-4" style={{ marginRight: '0.5rem' }} /> {t('shared.recurring')}
          </Button>
        </>
      )}
      <HelpTooltip
        content={
          <div className="space-y-1.5">
            <p>
              <Trans t={t} i18nKey="page.csvHelpColumns" components={{ b: <strong /> }} />
            </p>
            <p>
              <Trans t={t} i18nKey="page.csvHelpCategories" components={{ b: <strong /> }} />
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
        <Upload className="h-4 w-4" style={{ marginRight: '0.5rem' }} /> {t('actions.importCsv')}
      </Button>
    </>
  );
  const primaryAction = (
    <Button onClick={() => openAdd('entrada')}>
      <Plus className="h-4 w-4" style={{ marginRight: '0.5rem' }} /> {t('shared.income')}
    </Button>
  );
  const saidaAction = (
    <Button variant="outline" onClick={() => openAdd('saida')}>
      <Plus className="h-4 w-4" style={{ marginRight: '0.5rem' }} /> {t('shared.expense')}
    </Button>
  );
  // Toolbar: classic order, Entrada then Saída, both after the shell capsule.
  const inToolbar = usePageToolbar({
    title: t('shared.title'),
    titleAccessory: infoTooltip,
    actions: csvActions,
    primary: (
      <>
        {primaryAction}
        {saidaAction}
      </>
    ),
  });

  if (isPhone) {
    return (
      <>
        <FinanceiroPhone
          isLoading={isLoading}
          transacoes={filtered}
          canSeeFinancials={canSeeFinancials}
          kpis={{ recebido, aReceber, aPagar, saldoAtual, saldoProjetado }}
          filter={filter}
          onFilterChange={setFilter}
          search={search}
          onSearchChange={setSearch}
          monthFilter={monthFilter}
          onMonthFilterChange={setMonthFilter}
          onAdd={openAdd}
          onImport={handleCSVImport}
          onRecorrentes={canSeeFinancials === true ? () => setRecorrentesOpen(true) : undefined}
          onEdit={openEdit}
          onConfirm={setConfirmT}
          onDelete={setDeleteId}
          selecting={phoneSelecting}
          onSelectingChange={setPhoneSelecting}
          rowKey={rowKey}
          selectedKeys={selectedKeys}
          onToggle={toggleOne}
          onToggleAll={toggleAll}
          allSelected={allSelected}
          selectedCount={selecionadas.length}
          onBulkConfirm={() => setBulkConfirmOpen(true)}
        />
        {dialogs}
      </>
    );
  }

  return (
    <div className="page-content">
      {!inToolbar && (
        <div className="header">
          <div
            className="header-title"
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          >
            <h1>{t('shared.title')}</h1>
            {infoTooltip}
          </div>
          <div className="header-actions">
            {csvActions}
            {primaryAction}
            {saidaAction}
          </div>
        </div>
      )}

      <StatCardGrid style={{ marginBottom: '1.5rem' }}>
        {(
          [
            {
              label: t('shared.kpis.received'),
              value: formatFinancialBRL(recebido, canSeeFinancials),
              icon: CheckCircle2,
              tone: 'green' as const,
            },
            {
              label: t('shared.kpis.toReceive'),
              value: formatFinancialBRL(aReceber, canSeeFinancials),
              icon: ArrowDownCircle,
              tone: 'amber' as const,
            },
            {
              label: t('shared.kpis.toPay'),
              value: formatFinancialBRL(aPagar, canSeeFinancials),
              icon: ArrowUpCircle,
              tone: 'red' as const,
            },
            {
              label: t('shared.kpis.currentBalance'),
              value: formatFinancialBRL(saldoAtual, canSeeFinancials),
              icon: Wallet,
              tone: saldoAtual >= 0 ? ('green' as const) : ('red' as const),
            },
            {
              label: t('shared.kpis.projectedBalance'),
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
            placeholder={t('shared.searchPlaceholder')}
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
            <SelectItem value="todas">{t('shared.filters.all')}</SelectItem>
            <SelectItem value="entradas">{t('shared.filters.income')}</SelectItem>
            <SelectItem value="saidas">{t('shared.filters.expenses')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        isDesktop ? (
          <TableSkeleton columns={6} />
        ) : (
          <CardListSkeleton />
        )
      ) : (
        <>
          {/* Desktop table */}
          {selecionadas.length > 0 && (
            <div
              className="financeiro-desktop-table"
              style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.75rem' }}
            >
              <Button onClick={() => setBulkConfirmOpen(true)}>
                <Check className="h-3 w-3" />{' '}
                {t('page.confirmSelected', { n: selecionadas.length })}
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
                      aria-label={t('page.selectAllScheduled')}
                    />
                  </TableHead>
                  <TableHead>{t('form.date')}</TableHead>
                  <TableHead>{t('form.description')}</TableHead>
                  <TableHead>{t('form.category')}</TableHead>
                  <TableHead>{t('page.columns.amount')}</TableHead>
                  <TableHead>{t('filter.status')}</TableHead>
                  <TableHead>{t('page.columns.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((tr, i) => (
                  <TableRow key={tr.id ?? `proj-${i}`}>
                    <TableCell style={{ paddingLeft: '0.75rem' }}>
                      {tr.status === 'agendado' && (
                        <Checkbox
                          checked={selectedKeys.has(rowKey(tr))}
                          onCheckedChange={() => toggleOne(tr)}
                          aria-label={t('page.selectTransaction')}
                        />
                      )}
                    </TableCell>
                    <TableCell data-label={t('form.date')}>{formatDate(tr.data)}</TableCell>
                    <TableCell data-label={t('form.description')}>
                      <div>{tr.descricao}</div>
                      {tr.detalhe && (
                        <div style={{ fontSize: 12, color: '#888' }}>{tr.detalhe}</div>
                      )}
                    </TableCell>
                    <TableCell data-label={t('form.category')}>{tr.categoria}</TableCell>
                    <TableCell data-label={t('page.columns.amount')}>
                      <span
                        style={{
                          color: tr.tipo === 'entrada' ? '#3ecf8e' : '#ef4444',
                          fontWeight: 600,
                        }}
                      >
                        {tr.tipo === 'entrada' ? '+' : '-'}
                        {formatFinancialBRL(tr.valor, canSeeFinancials)}
                      </span>
                    </TableCell>
                    <TableCell data-label={t('filter.status')}>
                      <Badge variant={tr.status === 'pago' ? 'success' : 'neutral'}>
                        {tr.status === 'pago' ? t('status.pago') : t('status.agendado')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1" style={{ justifyContent: 'flex-end' }}>
                        {tr.status === 'agendado' ? (
                          <Button size="sm" variant="outline" onClick={() => setConfirmT(tr)}>
                            <Check className="h-3 w-3" /> {t('actions.confirm')}
                          </Button>
                        ) : (
                          <>
                            <Button size="icon" variant="ghost" onClick={() => openEdit(tr)}>
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            {tr.id && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="text-destructive"
                                onClick={() => setDeleteId(tr.id!)}
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
            {filtered.map((tr, i) => (
              <div key={tr.id ?? `proj-${i}`} className="team-card card animate-up">
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
                      <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{tr.descricao}</span>
                      <Badge
                        variant={tr.status === 'pago' ? 'success' : 'neutral'}
                        size="sm"
                        style={{ pointerEvents: 'none' }}
                      >
                        {tr.status === 'pago' ? t('status.pago') : t('status.agendado')}
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
                          color: tr.tipo === 'entrada' ? '#3ecf8e' : '#ef4444',
                          fontWeight: 600,
                          fontSize: '0.85rem',
                        }}
                      >
                        {tr.tipo === 'entrada' ? '+' : '-'}
                        {formatFinancialBRL(tr.valor, canSeeFinancials)}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: '#888' }}>&bull;</span>
                      <span style={{ fontSize: '0.75rem', color: '#888' }}>
                        {formatDate(tr.data)}
                      </span>
                      {tr.categoria && (
                        <>
                          <span style={{ fontSize: '0.75rem', color: '#888' }}>&bull;</span>
                          <span style={{ fontSize: '0.75rem', color: '#888' }}>{tr.categoria}</span>
                        </>
                      )}
                    </div>
                  </div>
                  {tr.status === 'agendado' ? (
                    <Button size="sm" className="shrink-0 mb-0" onClick={() => setConfirmT(tr)}>
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
                        <DropdownMenuItem onClick={() => openEdit(tr)}>
                          <Edit2 className="h-4 w-4 mr-2" />
                          {t('actions.edit')}
                        </DropdownMenuItem>
                        {tr.id && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => setDeleteId(tr.id!)}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              {t('actions.delete')}
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

      {dialogs}
    </div>
  );
}
