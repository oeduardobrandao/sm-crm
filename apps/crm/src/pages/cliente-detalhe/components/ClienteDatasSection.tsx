import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
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
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  getClienteDatas,
  addClienteData,
  updateClienteData,
  removeClienteData,
  formatDate,
  type ClienteData,
} from '@/store';
import { ResponsiveCardRail } from '../ResponsiveCardRail';

interface ClienteDatasSectionProps {
  clienteId: number;
}

/**
 * Important-dates card for the client's "Visão geral" tab — CRUD ported
 * verbatim from the pre-split ClienteDetalhePage (see git history at
 * d30adeea). Owns its own `['clienteDatas', clienteId]` query so this tab
 * never has to reach into the other domain queries the monolith used to
 * share.
 */
export function ClienteDatasSection({ clienteId }: ClienteDatasSectionProps) {
  const { t } = useTranslation('clients');
  const { t: tc } = useTranslation();
  const queryClient = useQueryClient();

  const { data: datasImportantes, isLoading: loadingDatas } = useQuery({
    queryKey: ['clienteDatas', clienteId],
    queryFn: () => getClienteDatas(clienteId),
    enabled: !isNaN(clienteId),
  });

  const [dateModalOpen, setDateModalOpen] = useState(false);
  const [dateLoading, setDateLoading] = useState(false);
  const [dateEditing, setDateEditing] = useState<ClienteData | null>(null);
  const [dateDeleteId, setDateDeleteId] = useState<number | null>(null);
  const [dateTitulo, setDateTitulo] = useState('');
  const [dateData, setDateData] = useState('');

  const resetDateForm = () => {
    setDateTitulo('');
    setDateData('');
    setDateEditing(null);
  };

  const handleOpenDateModal = (d?: ClienteData) => {
    if (d) {
      setDateEditing(d);
      setDateTitulo(d.titulo);
      setDateData(d.data);
    } else {
      resetDateForm();
    }
    setDateModalOpen(true);
  };

  const handleDateSubmit = async () => {
    if (!dateTitulo || !dateData) {
      toast.error(t('detail.fillTitleAndDate'));
      return;
    }
    setDateLoading(true);
    try {
      if (dateEditing?.id) {
        await updateClienteData(dateEditing.id, { titulo: dateTitulo, data: dateData });
        toast.success(t('detail.dateUpdated'));
      } else {
        await addClienteData({ cliente_id: clienteId, titulo: dateTitulo, data: dateData });
        toast.success(t('detail.dateAdded'));
      }
      queryClient.invalidateQueries({ queryKey: ['clienteDatas', clienteId] });
      setDateModalOpen(false);
      resetDateForm();
    } catch (err: unknown) {
      toast.error(t('detail.genericError', { error: (err as Error).message }));
    } finally {
      setDateLoading(false);
    }
  };

  const handleDateDelete = async () => {
    if (!dateDeleteId) return;
    try {
      await removeClienteData(dateDeleteId);
      queryClient.invalidateQueries({ queryKey: ['clienteDatas', clienteId] });
      toast.success(t('detail.dateRemoved'));
    } catch (err: unknown) {
      toast.error(t('detail.genericError', { error: (err as Error).message }));
    }
    setDateDeleteId(null);
  };

  return (
    <>
      <div id="sec-datas" className="card animate-up" style={{ marginBottom: '1.5rem' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1rem',
          }}
        >
          <h3 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2 mb-0">
            <CalendarDays className="h-5 w-5" style={{ color: 'var(--primary-color)' }} />
            {t('detail.importantDates')}
          </h3>
          <Button size="sm" onClick={() => handleOpenDateModal()}>
            <Plus className="h-4 w-4" style={{ marginRight: 4 }} /> {tc('actions.add')}
          </Button>
        </div>

        {loadingDatas && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '1.5rem' }}>
            <Spinner size="sm" />
          </div>
        )}

        {!loadingDatas && (!datasImportantes || datasImportantes.length === 0) && (
          <div
            style={{
              textAlign: 'center',
              padding: '2rem 1rem',
              color: 'var(--text-muted)',
              border: '1px dashed var(--border-color)',
              borderRadius: '12px',
            }}
          >
            <CalendarDays className="h-8 w-8" style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
            <p style={{ fontSize: '0.9rem' }}>{t('detail.noImportantDates')}</p>
            <p style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>{t('detail.addDateHint')}</p>
          </div>
        )}

        {!loadingDatas && datasImportantes && datasImportantes.length > 0 && (
          <ResponsiveCardRail className="cliente-dates-rail">
            {datasImportantes.map((d) => (
              <div
                key={d.id}
                className="cliente-date-card"
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)';
                  (e.currentTarget as HTMLDivElement).style.boxShadow =
                    '0 6px 16px rgba(0,0,0,0.08)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.transform = '';
                  (e.currentTarget as HTMLDivElement).style.boxShadow = '';
                }}
              >
                <div>
                  <p style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.1rem' }}>
                    {d.titulo}
                  </p>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {formatDate(d.data)}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <Button
                    variant="ghost"
                    size="icon"
                    style={{ width: 28, height: 28 }}
                    onClick={() => handleOpenDateModal(d)}
                    aria-label={`${t('detail.editDate')}: ${d.titulo}`}
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    style={{ width: 28, height: 28, color: 'var(--danger)' }}
                    onClick={() => setDateDeleteId(d.id!)}
                    aria-label={`${t('detail.removeDate')}: ${d.titulo}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            ))}
          </ResponsiveCardRail>
        )}
      </div>

      {/* Date Add/Edit Modal */}
      <Dialog
        open={dateModalOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDateModalOpen(false);
            resetDateForm();
          }
        }}
      >
        <DialogContent
          style={{ maxWidth: 440 }}
          onConfirmClose={() => {
            setDateModalOpen(false);
            resetDateForm();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {dateEditing ? t('detail.editDate') : t('detail.newImportantDate')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t('detail.dateTitle')}</Label>
              <Input
                placeholder={t('detail.dateTitlePlaceholder')}
                value={dateTitulo}
                onChange={(e) => setDateTitulo(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>{t('detail.dateField')}</Label>
              <Input type="date" value={dateData} onChange={(e) => setDateData(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDateModalOpen(false);
                resetDateForm();
              }}
            >
              {tc('actions.cancel')}
            </Button>
            <Button onClick={handleDateSubmit} disabled={dateLoading}>
              {dateLoading && <Spinner size="sm" />}{' '}
              {dateEditing ? tc('actions.save') : tc('actions.add')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Date Delete Confirm */}
      <AlertDialog
        open={dateDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setDateDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('detail.removeDate')}</AlertDialogTitle>
            <AlertDialogDescription>{t('detail.removeDateConfirm')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDateDelete}>{tc('actions.delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default ClienteDatasSection;
