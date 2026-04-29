import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Plus, Edit2, Trash2, Upload, Info, HelpCircle, UserPlus, Search, SlidersHorizontal, MoreVertical, ArrowUpDown } from 'lucide-react';
import { openCSVSelector } from '../../lib/csv';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/ui/spinner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import {
  getLeads, addLead, updateLead, removeLead, addCliente, getInitials,
  type Lead,
} from '../../store';

function createLeadSchema(t: (key: string) => string) {
  return z.object({
    nome: z.string().min(1, t('validation.nameRequired')),
    email: z.string().email(t('validation.emailInvalid')).or(z.literal('')),
    instagram: z.string(),
    canal: z.string(),
    especialidade: z.string(),
    faturamento: z.string(),
    tags: z.string(),
    notas: z.string(),
    status: z.enum(['novo', 'contatado', 'qualificado', 'perdido', 'convertido']),
  });
}
type LeadFormValues = z.infer<ReturnType<typeof createLeadSchema>>;

function createConvertSchema(t: (key: string) => string) {
  return z.object({
    nome: z.string().min(1, t('validation.nameRequired')),
    email: z.string().email(t('validation.emailInvalid')).or(z.literal('')),
    telefone: z.string(),
    plano: z.string(),
    valor: z.string(),
    diaPag: z
      .string()
      .refine((v) => v === '' || (Number(v) >= 1 && Number(v) <= 31), t('validation.dayRange')),
  });
}
type ConvertFormValues = z.infer<ReturnType<typeof createConvertSchema>>;

const CANAL_KEYS = ['Instagram', 'Facebook', 'Google Ads', 'Indicação', 'Site', 'WhatsApp', 'Typeform', 'Outro'] as const;
const FATURAMENTO_KEYS = ['upTo5k', '5kTo10k', '10kTo20k', '20kTo50k', 'above50k'] as const;
const FATURAMENTO_DB_VALUES: Record<string, string> = {
  'upTo5k': 'Até R$ 5.000/mês',
  '5kTo10k': 'De R$ 5.000 a R$ 10.000/mês',
  '10kTo20k': 'De R$ 10.000 a R$ 20.000/mês',
  '20kTo50k': 'De R$ 20.000 a R$ 50.000/mês',
  'above50k': 'Acima de R$ 50.000/mês',
};
type StatusFilter = 'todos' | Lead['status'];
type SortDir = 'asc' | 'desc';

function parseInstagram(raw: string): string {
  if (!raw) return '';
  let val = raw.trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/$/, '').replace(/^@/, '');
  return val ? `@${val}` : '';
}

export default function LeadsPage() {
  const qc = useQueryClient();
  const { t, i18n } = useTranslation('leads');
  const { t: tc } = useTranslation();
  const locale = i18n.language === 'en' ? 'en-US' : 'pt-BR';
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('todos');
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState<string>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [convertModalOpen, setConvertModalOpen] = useState(false);
  const [convertingLead, setConvertingLead] = useState<Lead | null>(null);
  const [convertSaving, setConvertSaving] = useState(false);

  const leadSchema = useMemo(() => createLeadSchema(t), [t]);
  const convertSchema = useMemo(() => createConvertSchema(t), [t]);

  const form = useForm<LeadFormValues>({
    resolver: zodResolver(leadSchema),
    defaultValues: {
      nome: '', email: '', instagram: '', canal: '', especialidade: '',
      faturamento: '', tags: '', notas: '', status: 'novo',
    },
  });

  const convertForm = useForm<ConvertFormValues>({
    resolver: zodResolver(convertSchema),
    defaultValues: { nome: '', email: '', telefone: '', plano: '', valor: '', diaPag: '' },
  });

  const { data: leads = [], isLoading } = useQuery({ queryKey: ['leads'], queryFn: getLeads });

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };
  const sortIcon = (col: string) => sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  const filtered = useMemo(() => {
    let list = leads;
    if (filterStatus !== 'todos') list = list.filter(l => l.status === filterStatus);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(l => [l.nome, l.email, l.instagram, l.especialidade, l.canal, l.tags].some(v => v?.toLowerCase().includes(q)));
    }
    return [...list].sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[sortCol] as string ?? '';
      const bv = (b as unknown as Record<string, unknown>)[sortCol] as string ?? '';
      const cmp = av.localeCompare(bv);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [leads, filterStatus, search, sortCol, sortDir]);

  const openAdd = () => {
    setEditing(null);
    form.reset({
      nome: '', email: '', instagram: '', canal: '', especialidade: '',
      faturamento: '', tags: '', notas: '', status: 'novo',
    });
    setModalOpen(true);
  };

  const openEdit = (l: Lead) => {
    setEditing(l);
    form.reset({
      nome: l.nome,
      email: l.email || '',
      instagram: l.instagram || '',
      canal: l.canal || '',
      especialidade: l.especialidade || '',
      faturamento: l.faturamento || '',
      tags: l.tags || '',
      notas: l.notas || '',
      status: l.status,
    });
    setModalOpen(true);
  };

  const onSubmit = async (values: LeadFormValues) => {
    setSaving(true);
    try {
      const payload: Omit<Lead, 'id' | 'user_id' | 'conta_id' | 'created_at'> = {
        nome: values.nome,
        email: values.email,
        telefone: '',
        instagram: parseInstagram(values.instagram),
        canal: values.canal,
        especialidade: values.especialidade,
        faturamento: values.faturamento,
        tags: values.tags,
        notas: values.notas,
        objetivo: '',
        origem: 'manual',
        status: values.status,
      };
      if (editing?.id) {
        await updateLead(editing.id, payload);
        toast.success(t('toast.updated'));
      } else {
        await addLead(payload);
        toast.success(t('toast.created'));
      }
      qc.invalidateQueries({ queryKey: ['leads'] });
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
      await removeLead(deleteId);
      toast.success(t('toast.removed'));
      qc.invalidateQueries({ queryKey: ['leads'] });
    } catch {
      toast.error(tc('toast.deleteError'));
    }
    setDeleteId(null);
  };

  const handleStatusChange = async (id: number, status: Lead['status']) => {
    try {
      await updateLead(id, { status });
      qc.invalidateQueries({ queryKey: ['leads'] });
    } catch {
      toast.error(t('toast.statusError'));
    }
  };

  const AVATAR_COLORS = ['#e74c3c','#8e44ad','#27ae60','#2980b9','#d35400','#16a085'];

  const openConvert = (l: Lead) => {
    setConvertingLead(l);
    convertForm.reset({
      nome: l.nome,
      email: l.email || '',
      telefone: '', plano: '', valor: '', diaPag: '',
    });
    setConvertModalOpen(true);
  };

  const onConvertSubmit = async (values: ConvertFormValues) => {
    if (!convertingLead?.id) return;
    setConvertSaving(true);
    try {
      const randomColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
      await addCliente({
        nome: values.nome,
        email: values.email,
        telefone: values.telefone,
        plano: values.plano,
        valor_mensal: values.valor ? Number(values.valor) : 0,
        notion_page_url: '',
        data_pagamento: values.diaPag ? parseInt(values.diaPag, 10) : undefined,
        sigla: getInitials(values.nome),
        cor: randomColor,
        status: 'ativo',
      });
      await updateLead(convertingLead.id, { status: 'convertido' });
      toast.success(t('toast.converted'));
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['clientes'] });
      setConvertModalOpen(false);
    } catch {
      toast.error(t('toast.convertError'));
    } finally {
      setConvertSaving(false);
    }
  };

  const handleCSVImport = () => {
    openCSVSelector(
      async (rows) => {
        let count = 0;
        for (const row of rows) {
          if (!row.nome) continue;
          try {
            await addLead({
              nome: row.nome,
              email: row.email || '',
              telefone: row.telefone || '',
              instagram: parseInstagram(row.instagram || ''),
              canal: row.canal || '',
              especialidade: row.especialidade || '',
              faturamento: row.faturamento || '',
              tags: row.tags || '',
              notas: row.notas || '',
              objetivo: row.objetivo || '',
              origem: 'manual',
              status: (['novo', 'contatado', 'qualificado', 'perdido', 'convertido'].includes(row.status) ? row.status : 'novo') as Lead['status'],
            });
            count++;
          } catch { /* skip row */ }
        }
        toast.success(t('toast.csvImport', { count }));
        qc.invalidateQueries({ queryKey: ['leads'] });
      },
      (err) => toast.error(err.message),
    );
  };

  const STATUS_KEYS = ['novo', 'contatado', 'qualificado', 'perdido', 'convertido'] as const;

  return (
    <div className="page-content">
      <div className="header">
        <div className="header-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <h1>{t('title')}</h1>
          <span data-tooltip={t('tooltip')} data-tooltip-dir="right" style={{ display: 'flex' }}>
            <Info className="h-5 w-5 cursor-pointer" style={{ color: 'var(--text-muted)' }} />
          </span>
        </div>
        <div className="header-actions">
          <span data-tooltip={t('csvTooltip')} data-tooltip-dir="bottom" style={{ display: 'flex' }}>
            <HelpCircle className="h-4 w-4" style={{ color: 'var(--text-muted)', cursor: 'pointer' }} />
          </span>
          <Button variant="outline" onClick={handleCSVImport}><Upload className="h-4 w-4" style={{ marginRight: '0.5rem' }} /> {tc('actions.importCsv')}</Button>
          <Button onClick={openAdd}><Plus className="h-4 w-4" style={{ marginRight: '0.5rem' }} /> {t('newLead')}</Button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search className="h-4 w-4" style={{ position: 'absolute', left: '0.625rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <Input className="h-9" placeholder={t('searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: '2rem' }} />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" className="h-9 w-9 shrink-0 mb-0" style={{ position: 'relative' }}>
              <SlidersHorizontal className="h-4 w-4" />
              {(filterStatus !== 'todos' || sortCol !== 'created_at' || sortDir !== 'desc') && (
                <span style={{ position: 'absolute', top: -2, right: -2, width: 8, height: 8, borderRadius: '50%', background: 'var(--primary-color)' }} />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>{tc('filter.status')}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={filterStatus} onValueChange={(v) => setFilterStatus(v as StatusFilter)}>
              {(['todos', ...STATUS_KEYS] as StatusFilter[]).map(f => (
                <DropdownMenuRadioItem key={f} value={f}>
                  {tc(`status.${f}`)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{tc('filter.sortBy')}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={sortCol} onValueChange={v => { setSortCol(v); setSortDir('asc'); }}>
              <DropdownMenuRadioItem value="nome">{tc('sort.name')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="email">{t('table.email')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="canal">{t('table.channel')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="created_at">{t('table.createdAt')}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}>
              <ArrowUpDown className="h-4 w-4 mr-2" />{sortDir === 'asc' ? tc('sort.descending') : tc('sort.ascending')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {isLoading ? (
        <div className="flex justify-center p-8"><Spinner size="lg" /></div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="card leads-desktop-table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead style={{ cursor: 'pointer', fontWeight: '800' }} onClick={() => handleSort('nome')}>{t('table.name')}{sortIcon('nome')}</TableHead>
                  <TableHead style={{ cursor: 'pointer', fontWeight: '800' }} onClick={() => handleSort('email')}>{t('table.email')}{sortIcon('email')}</TableHead>
                  <TableHead style={{ cursor: 'pointer', fontWeight: '800' }} onClick={() => handleSort('canal')}>{t('table.channel')}{sortIcon('canal')}</TableHead>
                  <TableHead style={{ cursor: 'pointer', fontWeight: '800' }} onClick={() => handleSort('especialidade')}>{t('table.specialty')}{sortIcon('especialidade')}</TableHead>
                  <TableHead style={{ cursor: 'pointer', fontWeight: '800' }}>{t('table.status')}</TableHead>
                  <TableHead style={{ cursor: 'pointer', fontWeight: '800' }} onClick={() => handleSort('created_at')}>{t('table.created')}{sortIcon('created_at')}</TableHead>
                  <TableHead style={{ fontWeight: '800' }}>{t('table.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(l => (
                  <TableRow key={l.id ?? l.nome}>
                    <TableCell data-label={t('table.name')}>
                      <div>{l.nome}</div>
                      {l.instagram && <div style={{ fontSize: 12, color: '#888' }}>{l.instagram}</div>}
                    </TableCell>
                    <TableCell data-label={t('table.email')}>{l.email}</TableCell>
                    <TableCell data-label={t('table.channel')}>{l.canal}</TableCell>
                    <TableCell data-label={t('table.specialty')}>{l.especialidade}</TableCell>
                    <TableCell data-label={t('table.status')}>
                      <Select value={l.status} onValueChange={val => l.id && handleStatusChange(l.id, val as Lead['status'])}>
                        <SelectTrigger style={{ width: 140 }}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STATUS_KEYS.map(v => (
                            <SelectItem key={v} value={v}>{tc(`status.${v}`)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell data-label={t('table.created')}>{l.created_at ? new Date(l.created_at).toLocaleDateString(locale) : '—'}</TableCell>
                    <TableCell>
                      <div className="flex gap-1" style={{ justifyContent: 'flex-end' }}>
                        <Button size="icon" variant="ghost" title={t('convertToClient')} onClick={() => openConvert(l)}>
                          <UserPlus className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => openEdit(l)}>
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        {l.id && (
                          <Button size="icon" variant="ghost" className="text-destructive" onClick={() => setDeleteId(l.id!)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <div className="leads-mobile-cards">
            {filtered.map(l => (
              <div key={l.id ?? l.nome} className="team-card card animate-up">
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{l.nome}</span>
                      <Badge variant={l.status === 'novo' ? 'default' : l.status === 'qualificado' ? 'default' : l.status === 'convertido' ? 'default' : 'secondary'} style={{ fontSize: '0.6rem', padding: '0 0.4rem', pointerEvents: 'none' }}>
                        {tc(`status.${l.status}`)}
                      </Badge>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#888', display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: 2 }}>
                      {l.instagram && <span>{l.instagram}</span>}
                      {l.instagram && l.canal && <span>&bull;</span>}
                      {l.canal && <span>{l.canal}</span>}
                      {(l.instagram || l.canal) && l.created_at && <span>&bull;</span>}
                      {l.created_at && <span>{new Date(l.created_at).toLocaleDateString(locale)}</span>}
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 mb-0">
                        <MoreVertical className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openConvert(l)}>
                        <UserPlus className="h-4 w-4 mr-2" />{t('convertToClient')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openEdit(l)}>
                        <Edit2 className="h-4 w-4 mr-2" />{tc('actions.edit')}
                      </DropdownMenuItem>
                      {l.id && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive" onClick={() => setDeleteId(l.id!)}>
                            <Trash2 className="h-4 w-4 mr-2" />{tc('actions.delete')}
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto" onConfirmClose={() => setModalOpen(false)}>
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
                    <FormControl><Input {...field} /></FormControl>
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
                    <FormControl><Input type="email" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="instagram"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('form.instagram')}</FormLabel>
                    <FormControl><Input placeholder={t('form.instagramPlaceholder')} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="canal"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('form.channel')}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder={t('form.selectPlaceholder')} /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {CANAL_KEYS.map(c => <SelectItem key={c} value={c}>{t(`channels.${c}`)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="especialidade"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('form.specialty')}</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="faturamento"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('form.revenue')}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder={t('form.selectPlaceholder')} /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {FATURAMENTO_KEYS.map(k => <SelectItem key={k} value={FATURAMENTO_DB_VALUES[k]}>{t(`revenue.${k}`)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="tags"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('form.tags')}</FormLabel>
                    <FormControl><Input placeholder={t('form.tagsPlaceholder')} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="notas"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('form.notes')}</FormLabel>
                    <FormControl><Textarea rows={3} {...field} /></FormControl>
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
                          <SelectTrigger><SelectValue /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {STATUS_KEYS.map(v => <SelectItem key={v} value={v}>{tc(`status.${v}`)}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>{tc('actions.cancel')}</Button>
                <Button type="submit" disabled={saving}>
                  {saving && <Spinner size="sm" />} {tc('actions.save')}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={convertModalOpen} onOpenChange={setConvertModalOpen}>
        <DialogContent onConfirmClose={() => setConvertModalOpen(false)}>
          <DialogHeader>
            <DialogTitle>{t('convertDialog.title')}</DialogTitle>
          </DialogHeader>
          <Form {...convertForm}>
            <form onSubmit={convertForm.handleSubmit(onConvertSubmit)} className="space-y-3">
              <FormField
                control={convertForm.control}
                name="nome"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('form.name')}</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={convertForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('form.email')}</FormLabel>
                    <FormControl><Input type="email" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={convertForm.control}
                name="telefone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('form.phone')}</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={convertForm.control}
                name="plano"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('form.plan')}</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={convertForm.control}
                name="valor"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('form.monthlyValue')}</FormLabel>
                    <FormControl><Input type="number" min={0} step={0.01} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={convertForm.control}
                name="diaPag"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('form.paymentDay')}</FormLabel>
                    <FormControl><Input type="number" min={1} max={31} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setConvertModalOpen(false)}>{tc('actions.cancel')}</Button>
                <Button type="submit" disabled={convertSaving}>
                  {convertSaving && <Spinner size="sm" />} {t('convertDialog.submit')}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId != null} onOpenChange={open => { if (!open) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{t('deleteConfirm')}</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc('actions.no')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>{tc('actions.yes')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
