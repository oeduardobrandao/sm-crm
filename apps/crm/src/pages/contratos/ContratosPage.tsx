import { useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { holdUnsavedWork, useUnsavedWork } from '@mesaas/app-lifecycle';
import { Plus, Edit2, Trash2, Upload, Info, HelpCircle, Search, UserRound } from 'lucide-react';
import { openCSVSelector } from '../../lib/csv';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { TableSkeleton } from '@/components/ui/skeletons';
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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChevronDown } from 'lucide-react';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { DatePicker } from '@/components/ui/date-picker';
import {
  getContratos,
  addContrato,
  updateContrato,
  removeContrato,
  getClientes,
  sortClientesByNome,
  formatDate,
  type Contrato,
} from '../../store';
import { useAuth } from '../../context/AuthContext';
import { handleEntitlementMutationError } from '@/lib/entitlement-toast';
import { formatFinancialBRL } from '@/lib/financialAccess';
import { captureEvent } from '@/lib/analytics';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { usePhoneLayout } from '@/components/layout/PhoneLayoutContext';
import { usePageToolbar } from '@/components/layout/PageToolbarContext';
import { GroupedList, Cell } from '@/components/mobile/GroupedList';
import { FormRow } from '@/components/mobile/FormRow';
import { PickerCell } from '@/components/mobile/PickerSheet';
import { ContratosPhone } from './phone/ContratosPhone';
import { useReadOnlyGrandfather } from '@/components/paywall/useReadOnlyGrandfather';
import { ReadOnlyNotice } from '@/components/paywall/ReadOnlyNotice';
import { lazyLabels } from '@/pages/entregas/postLabels';

// Built per render so the messages follow the UI language.
const makeContratoSchema = (t: TFunction<'contracts'>) =>
  z.object({
    titulo: z.string().min(1, t('validation.titleRequired')),
    clienteId: z.string(),
    dataInicio: z.string().min(1, t('validation.startRequired')),
    dataFim: z.string().min(1, t('validation.endRequired')),
    valor: z
      .string()
      .min(1, t('validation.valueRequired'))
      .refine((v) => Number(v) > 0, t('validation.valuePositive')),
    status: z.enum(['a_assinar', 'vigente', 'encerrado']),
  });
type ContratoFormValues = z.infer<ReturnType<typeof makeContratoSchema>>;

function isoToDate(iso: string): Date | undefined {
  if (!iso) return undefined;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function dateToIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type FilterStatus = 'todos' | 'vigente' | 'a_assinar' | 'encerrado';

const STATUS_LABEL: Record<string, string> = lazyLabels(
  ['vigente', 'a_assinar', 'encerrado'] as const,
  (k) => `contracts:status.${k}`,
);

export default function ContratosPage() {
  // Keyed on CONTRATOS, not FINANCEIRO: this page's RLS policies and its nav
  // entry both key on contratos, and AppLayout's route guard now does too
  // (CONTRACT_PATHS). Masking on the financial capability made a custom role
  // of {contratos: editar, financeiro: none} see masked values on a page it
  // is fully authorized for. Legacy roles are unaffected -- derivePermission
  // couples the two capabilities for every one of them.
  const { t } = useTranslation('contracts');
  const { can, profile } = useAuth();
  const canSeeContracts = can('contratos', 'ver');
  // Ex-reverse-trial workspace on Free: consultation only, every mutating control hidden.
  const { readOnly } = useReadOnlyGrandfather('feature_contracts');
  const qc = useQueryClient();
  const navigate = useNavigate();
  // Below 768px the page is the phone list (PLAN F2d). The form body follows the dialog
  // primitive, which becomes a sheet only inside the phone shell (PhoneLayoutContext).
  const isPhone = !useIsDesktop(768);
  const { isPhone: phoneForm } = usePhoneLayout();
  const [filter, setFilter] = useState<FilterStatus>('todos');
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Contrato | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  useUnsavedWork(saving);

  const contratoSchema = useMemo(() => makeContratoSchema(t), [t]);
  const form = useForm<ContratoFormValues>({
    resolver: zodResolver(contratoSchema),
    defaultValues: {
      titulo: '',
      clienteId: '',
      dataInicio: '',
      dataFim: '',
      valor: '',
      status: 'a_assinar',
    },
  });

  const { data: contratos = [], isLoading } = useQuery({
    queryKey: ['contratos'],
    queryFn: getContratos,
    // Same belt-and-braces the financial pages use: the layout guard already
    // keeps an unauthorized member off this route, so this only ever matters
    // if that guard regresses -- and then the rows never reach the cache.
    enabled: canSeeContracts === true,
  });
  const { data: clientes = [] } = useQuery({ queryKey: ['clientes'], queryFn: getClientes });

  const filtered = contratos
    .filter((c) => filter === 'todos' || c.status === filter)
    .filter(
      (c) =>
        !search ||
        c.titulo.toLowerCase().includes(search.toLowerCase()) ||
        c.cliente_nome?.toLowerCase().includes(search.toLowerCase()),
    );

  const openAdd = () => {
    setEditing(null);
    form.reset({
      titulo: '',
      clienteId: '',
      dataInicio: '',
      dataFim: '',
      valor: '',
      status: 'a_assinar',
    });
    setModalOpen(true);
  };

  const openEdit = (c: Contrato) => {
    setEditing(c);
    form.reset({
      titulo: c.titulo,
      clienteId: c.cliente_id ? String(c.cliente_id) : '',
      dataInicio: c.data_inicio,
      dataFim: c.data_fim,
      valor: String(c.valor_total),
      status: c.status,
    });
    setModalOpen(true);
  };

  const onSubmit = async (values: ContratoFormValues) => {
    setSaving(true);
    try {
      const clienteId = values.clienteId ? Number(values.clienteId) : null;
      const clienteSel = clientes.find((c) => c.id === clienteId);
      const payload: Omit<Contrato, 'id' | 'user_id' | 'conta_id'> = {
        titulo: values.titulo,
        cliente_id: clienteId,
        cliente_nome: clienteSel?.nome ?? '',
        data_inicio: values.dataInicio,
        data_fim: values.dataFim,
        valor_total: Number(values.valor),
        status: values.status,
      };
      if (editing?.id) {
        await updateContrato(editing.id, payload);
        toast.success(t('toast.updated'));
      } else {
        await addContrato(payload);
        captureEvent('contract_created', { status: values.status });
        toast.success(t('toast.created'));
      }
      qc.invalidateQueries({ queryKey: ['contratos'] });
      setModalOpen(false);
    } catch (e) {
      // trg_feature_contracts gates `contratos` at the database, on a direct
      // client write: no edge function in the path, and store.ts is not a
      // TanStack mutation, so App.tsx's MutationCache.onError never sees it.
      // This catch is the only observation point for feature_contracts.
      if (!handleEntitlementMutationError(e, profile?.conta_id ?? null))
        toast.error(t('toast.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (deleteId == null) return;
    try {
      await removeContrato(deleteId);
      toast.success(t('toast.removed'));
      qc.invalidateQueries({ queryKey: ['contratos'] });
    } catch {
      toast.error(t('toast.removeError'));
    }
    setDeleteId(null);
  };

  const handleCSVImport = () => {
    openCSVSelector(
      async (rows) => {
        let count = 0;
        const release = holdUnsavedWork();
        try {
          for (const row of rows) {
            if (!row.titulo || !row.data_inicio || !row.data_fim || !row.valor_total) continue;
            try {
              const clienteMatch = row.cliente_nome
                ? clientes.find((c) => c.nome.toLowerCase() === row.cliente_nome.toLowerCase())
                : null;
              const status = (
                ['vigente', 'a_assinar', 'encerrado'].includes(row.status)
                  ? row.status
                  : 'a_assinar'
              ) as Contrato['status'];
              await addContrato({
                titulo: row.titulo,
                cliente_id: clienteMatch?.id ?? null,
                cliente_nome: row.cliente_nome || '',
                data_inicio: row.data_inicio,
                data_fim: row.data_fim,
                valor_total: Number(row.valor_total),
                status,
              });
              count++;
            } catch {
              /* skip row */
            }
          }
        } finally {
          release();
        }
        toast.success(t('toast.csvImported', { count }));
        qc.invalidateQueries({ queryKey: ['contratos'] });
      },
      (err) => toast.error(err.message),
    );
  };

  const clienteIdValue = useWatch({ control: form.control, name: 'clienteId' });
  const statusValue = useWatch({ control: form.control, name: 'status' });
  const { errors } = form.formState;
  const setField = (name: 'clienteId' | 'status', value: string) =>
    form.setValue(name, value as never, {
      shouldDirty: true,
      shouldValidate: form.formState.isSubmitted,
    });
  // Grouped rows on phones: dates stacked as native date controls, pickers as checkmark
  // lists, and the linked client one tap away while editing.
  const phoneFields = (
    <>
      <GroupedList aria-label={t('form.group')}>
        <FormRow
          label={t('form.titleField')}
          error={errors.titulo?.message}
          input={{ ...form.register('titulo'), autoComplete: 'off' }}
        />
        <FormRow label={t('form.startPhone')} error={errors.dataInicio?.message}>
          {(field) => (
            <input
              {...field}
              {...form.register('dataInicio')}
              type="date"
              className="phone-form-row__input"
            />
          )}
        </FormRow>
        <FormRow label={t('form.endPhone')} error={errors.dataFim?.message}>
          {(field) => (
            <input
              {...field}
              {...form.register('dataFim')}
              type="date"
              className="phone-form-row__input"
            />
          )}
        </FormRow>
        <FormRow
          label={t('form.totalValue')}
          error={errors.valor?.message}
          input={{
            ...form.register('valor'),
            type: 'number',
            inputMode: 'decimal',
            min: 0,
            step: 0.01,
            placeholder: t('form.valuePlaceholder'),
          }}
        />
      </GroupedList>
      <GroupedList>
        <PickerCell
          label={t('form.clientOptional')}
          sheetTitle={t('form.clientSheet')}
          searchable
          emptyOption={{ label: t('form.none') }}
          options={sortClientesByNome(clientes).map((c) => ({
            value: String(c.id),
            label: c.nome,
          }))}
          value={clienteIdValue || null}
          onChange={(v) => setField('clienteId', v ?? '')}
        />
        <PickerCell
          label={t('form.status')}
          options={[
            { value: 'a_assinar', label: t('status.a_assinar') },
            { value: 'vigente', label: t('status.vigente') },
            { value: 'encerrado', label: t('status.encerrado') },
          ]}
          value={statusValue}
          onChange={(v) => v && setField('status', v)}
        />
      </GroupedList>
      {editing?.cliente_id && (
        <GroupedList>
          <Cell
            icon={<UserRound aria-hidden="true" />}
            label={t('form.openClient')}
            value={editing.cliente_nome}
            chevron
            onClick={() => {
              setModalOpen(false);
              navigate(`/clientes/${editing.cliente_id}`);
            }}
          />
        </GroupedList>
      )}
    </>
  );

  const dialogs = (
    <>
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent onConfirmClose={() => setModalOpen(false)}>
          <DialogHeader>
            <DialogTitle>{editing ? t('form.dialogEdit') : t('form.dialogNew')}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              {phoneForm ? (
                phoneFields
              ) : (
                <>
                  <FormField
                    control={form.control}
                    name="titulo"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('form.titleField')}</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="clienteId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('form.clientOptional')}</FormLabel>
                        <Select
                          value={field.value || '__none__'}
                          onValueChange={(v) => field.onChange(v === '__none__' ? '' : v)}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder={t('form.select')} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="__none__">{t('form.none')}</SelectItem>
                            {sortClientesByNome(clientes).map((c) => (
                              <SelectItem key={c.id} value={String(c.id)}>
                                {c.nome}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      control={form.control}
                      name="dataInicio"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('form.startDesktop')}</FormLabel>
                          <FormControl>
                            <DatePicker
                              value={isoToDate(field.value)}
                              onChange={(d) => field.onChange(d ? dateToIso(d) : '')}
                              className="w-full"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="dataFim"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('form.endDesktop')}</FormLabel>
                          <FormControl>
                            <DatePicker
                              value={isoToDate(field.value)}
                              onChange={(d) => field.onChange(d ? dateToIso(d) : '')}
                              className="w-full"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="valor"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('form.totalValue')}</FormLabel>
                        <FormControl>
                          <Input type="number" min={0} step={0.01} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
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
                            <SelectItem value="a_assinar">{t('status.a_assinar')}</SelectItem>
                            <SelectItem value="vigente">{t('status.vigente')}</SelectItem>
                            <SelectItem value="encerrado">{t('status.encerrado')}</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
                  {t('form.cancel')}
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving && <Spinner size="sm" />} {t('form.save')}
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
            <AlertDialogTitle>{t('form.deleteTitle')}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('form.no')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>{t('form.yes')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  const infoTooltip = (
    <span data-tooltip={t('info')} data-tooltip-dir="right" style={{ display: 'flex' }}>
      <Info className="h-5 w-5 cursor-pointer" style={{ color: 'var(--text-muted)' }} />
    </span>
  );
  const headerActions = (
    <>
      <span data-tooltip={t('csvHelp')} data-tooltip-dir="bottom" style={{ display: 'flex' }}>
        <HelpCircle className="h-4 w-4" style={{ color: 'var(--text-muted)', cursor: 'pointer' }} />
      </span>
      {!readOnly && (
        <Button variant="outline" onClick={handleCSVImport}>
          <Upload className="h-4 w-4" style={{ marginRight: '0.5rem' }} /> {t('actions.importCsv')}
        </Button>
      )}
    </>
  );
  const primaryAction = readOnly ? null : (
    <Button onClick={openAdd}>
      <Plus className="h-4 w-4" style={{ marginRight: '0.5rem' }} /> {t('actions.newContract')}
    </Button>
  );

  const inToolbar = usePageToolbar({
    title: t('title'),
    titleAccessory: infoTooltip,
    actions: headerActions,
    primary: primaryAction,
  });

  if (isPhone) {
    return (
      <>
        <ContratosPhone
          readOnly={readOnly}
          isLoading={isLoading}
          contratos={filtered}
          canSeeValues={canSeeContracts}
          filter={filter}
          onFilterChange={setFilter}
          search={search}
          onSearchChange={setSearch}
          onAdd={openAdd}
          onImport={handleCSVImport}
          onEdit={openEdit}
          onDelete={setDeleteId}
          onOpenCliente={(clienteId) => navigate(`/clientes/${clienteId}`)}
        />
        {dialogs}
      </>
    );
  }

  return (
    // Under Vidro the panel already pads the content.
    <div style={inToolbar ? undefined : { padding: '1.5rem' }}>
      {!inToolbar && (
        <div className="header">
          <div
            className="header-title"
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          >
            <h1>{t('title')}</h1>
            {infoTooltip}
          </div>
          <div className="header-actions">
            {headerActions}
            {primaryAction}
          </div>
        </div>
      )}

      {readOnly && <ReadOnlyNotice />}

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: '320px' }}>
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
            placeholder={t('actions.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: '2rem' }}
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="h-9 rounded-full px-4 text-xs gap-1.5 font-normal shadow-sm mb-0"
            >
              {filter === 'todos' ? t('filter.status') : STATUS_LABEL[filter]}
              <ChevronDown className="h-3.5 w-3.5 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-40">
            <DropdownMenuRadioGroup
              value={filter}
              onValueChange={(v) => setFilter(v as FilterStatus)}
            >
              {(['todos', 'vigente', 'a_assinar', 'encerrado'] as FilterStatus[]).map((f) => (
                <DropdownMenuRadioItem key={f} value={f}>
                  {f === 'todos' ? t('filter.all') : STATUS_LABEL[f]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {isLoading ? (
        <TableSkeleton columns={6} />
      ) : (
        <div className="card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('table.contract')}</TableHead>
                <TableHead>{t('table.client')}</TableHead>
                <TableHead>{t('table.period')}</TableHead>
                <TableHead>{t('table.value')}</TableHead>
                <TableHead>{t('table.status')}</TableHead>
                {!readOnly && <TableHead>{t('table.actions')}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => (
                <TableRow key={c.id ?? c.titulo}>
                  <TableCell data-label={t('table.contract')}>{c.titulo}</TableCell>
                  <TableCell data-label={t('table.client')}>
                    {c.cliente_id ? (
                      <button
                        className="client-link"
                        onClick={() => navigate(`/clientes/${c.cliente_id}`)}
                      >
                        {c.cliente_nome}
                      </button>
                    ) : (
                      <span>{c.cliente_nome}</span>
                    )}
                  </TableCell>
                  <TableCell data-label={t('table.period')}>
                    {formatDate(c.data_inicio)} → {formatDate(c.data_fim)}
                  </TableCell>
                  <TableCell data-label={t('table.value')}>
                    {formatFinancialBRL(c.valor_total, canSeeContracts)}
                  </TableCell>
                  <TableCell data-label={t('table.status')}>
                    <Badge
                      variant={
                        c.status === 'vigente'
                          ? 'success'
                          : c.status === 'a_assinar'
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      {STATUS_LABEL[c.status]}
                    </Badge>
                  </TableCell>
                  {!readOnly && (
                    <TableCell>
                      <div className="flex gap-1" style={{ justifyContent: 'flex-end' }}>
                        <Button size="icon" variant="ghost" onClick={() => openEdit(c)}>
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        {c.id && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="text-destructive"
                            onClick={() => setDeleteId(c.id!)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {dialogs}
    </div>
  );
}
