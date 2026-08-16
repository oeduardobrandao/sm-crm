import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MapPin, Plus, Pencil, Trash2, Building2, Home, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  getClienteEnderecos,
  addClienteEndereco,
  updateClienteEndereco,
  removeClienteEndereco,
  type ClienteEndereco,
} from '@/store';
import { ResponsiveCardRail } from '../ResponsiveCardRail';

interface ClienteEnderecosSectionProps {
  clienteId: number;
}

/**
 * Addresses card for the client's "Visão geral" tab — CRUD + CEP autofill,
 * ported verbatim from the pre-split ClienteDetalhePage (see git history at
 * d30adeea). Owns its own `['clienteEnderecos', clienteId]` query so this tab
 * never has to reach into the other domain queries the monolith used to share.
 */
export function ClienteEnderecosSection({ clienteId }: ClienteEnderecosSectionProps) {
  const { t } = useTranslation('clients');
  const { t: tc } = useTranslation();
  const queryClient = useQueryClient();

  const { data: enderecos, isLoading: loadingEnderecos } = useQuery({
    queryKey: ['clienteEnderecos', clienteId],
    queryFn: () => getClienteEnderecos(clienteId),
    enabled: !isNaN(clienteId),
  });

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

  const resetAddrForm = () => {
    setAdrTipo('comercial');
    setAdrLogradouro('');
    setAdrNumero('');
    setAdrComplemento('');
    setAdrBairro('');
    setAdrCidade('');
    setAdrEstado('');
    setAdrCep('');
    setAddrEditing(null);
  };

  const handleOpenAddrModal = (addr?: ClienteEndereco) => {
    if (addr) {
      setAddrEditing(addr);
      setAdrTipo(addr.tipo);
      setAdrLogradouro(addr.logradouro);
      setAdrNumero(addr.numero);
      setAdrComplemento(addr.complemento || '');
      setAdrBairro(addr.bairro);
      setAdrCidade(addr.cidade);
      setAdrEstado(addr.estado);
      setAdrCep(addr.cep);
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
        toast.error(t('detail.cepNotFound'));
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
      toast.error(t('detail.fillRequired'));
      return;
    }
    setAddrLoading(true);
    try {
      const payload = {
        cliente_id: clienteId,
        tipo: adrTipo,
        logradouro: adrLogradouro,
        numero: adrNumero,
        complemento: adrComplemento,
        bairro: adrBairro,
        cidade: adrCidade,
        estado: adrEstado,
        cep: adrCep,
      };
      if (addrEditing?.id) {
        await updateClienteEndereco(addrEditing.id, payload);
        toast.success(t('detail.addressUpdated'));
      } else {
        await addClienteEndereco(payload);
        toast.success(t('detail.addressAdded'));
      }
      queryClient.invalidateQueries({ queryKey: ['clienteEnderecos', clienteId] });
      setAddrModalOpen(false);
      resetAddrForm();
    } catch (err: unknown) {
      toast.error(t('detail.addressSaveError', { error: (err as Error).message }));
    } finally {
      setAddrLoading(false);
    }
  };

  const handleAddrDelete = async () => {
    if (!addrDeleteId) return;
    try {
      await removeClienteEndereco(addrDeleteId);
      queryClient.invalidateQueries({ queryKey: ['clienteEnderecos', clienteId] });
      toast.success(t('detail.addressRemoved'));
    } catch (err: unknown) {
      toast.error(t('detail.addressRemoveError', { error: (err as Error).message }));
    }
    setAddrDeleteId(null);
  };

  return (
    <>
      <div id="sec-enderecos" className="card animate-up" style={{ marginBottom: '1.5rem' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1rem',
          }}
        >
          <h3 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2 mb-0">
            <MapPin className="h-5 w-5" style={{ color: 'var(--primary-color)' }} />
            {t('detail.addresses')}
          </h3>
          <Button size="sm" onClick={() => handleOpenAddrModal()}>
            <Plus className="h-4 w-4" style={{ marginRight: 4 }} /> {tc('actions.add')}
          </Button>
        </div>

        {loadingEnderecos && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '1.5rem' }}>
            <Spinner size="sm" />
          </div>
        )}

        {!loadingEnderecos && (!enderecos || enderecos.length === 0) && (
          <div
            style={{
              textAlign: 'center',
              padding: '2rem 1rem',
              color: 'var(--text-muted)',
              border: '1px dashed var(--border-color)',
              borderRadius: '12px',
            }}
          >
            <MapPin className="h-8 w-8" style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
            <p style={{ fontSize: '0.9rem' }}>{t('detail.noAddresses')}</p>
            <p style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>{t('detail.addAddressHint')}</p>
          </div>
        )}

        {!loadingEnderecos && enderecos && enderecos.length > 0 && (
          <ResponsiveCardRail className="cliente-addresses-rail">
            {enderecos.map((addr) => (
              <div
                key={addr.id}
                className="cliente-address-card"
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
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    marginBottom: '0.5rem',
                  }}
                >
                  <span
                    className={`badge ${addr.tipo === 'residencial' ? 'badge-info' : 'badge-warning'}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '0.75rem',
                    }}
                  >
                    {addr.tipo === 'residencial' ? (
                      <>
                        <Home className="h-3 w-3" /> {t('detail.residential')}
                      </>
                    ) : (
                      <>
                        <Building2 className="h-3 w-3" /> {t('detail.commercial')}
                      </>
                    )}
                  </span>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <Button
                      variant="ghost"
                      size="icon"
                      style={{ width: 28, height: 28 }}
                      onClick={() => handleOpenAddrModal(addr)}
                      aria-label={`${t('detail.editAddress')}: ${addr.logradouro}, ${addr.numero}`}
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      style={{ width: 28, height: 28, color: 'var(--danger)' }}
                      onClick={() => setAddrDeleteId(addr.id!)}
                      aria-label={`${t('detail.removeAddress')}: ${addr.logradouro}, ${addr.numero}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
                <p style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.15rem' }}>
                  {addr.logradouro}, {addr.numero}
                  {addr.complemento ? ` — ${addr.complemento}` : ''}
                </p>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {addr.bairro} · {addr.cidade}/{addr.estado}
                </p>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>CEP: {addr.cep}</p>
              </div>
            ))}
          </ResponsiveCardRail>
        )}
      </div>

      {/* Address Add/Edit Modal */}
      <Dialog
        open={addrModalOpen}
        onOpenChange={(open) => {
          if (!open) {
            setAddrModalOpen(false);
            resetAddrForm();
          }
        }}
      >
        <DialogContent
          style={{ maxWidth: 540 }}
          onConfirmClose={() => {
            setAddrModalOpen(false);
            resetAddrForm();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {addrEditing ? t('detail.editAddress') : t('detail.newAddress')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t('detail.addrType')}</Label>
              <Select
                value={adrTipo}
                onValueChange={(v) => setAdrTipo(v as 'residencial' | 'comercial')}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="comercial">{t('detail.commercial')}</SelectItem>
                  <SelectItem value="residencial">{t('detail.residential')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t('detail.addrCep')}</Label>
              <div style={{ position: 'relative' }}>
                <Input
                  placeholder="00000-000"
                  value={adrCep}
                  onChange={(e) => handleCepChange(e.target.value)}
                />
                {cepLoading && (
                  <div
                    style={{
                      position: 'absolute',
                      right: 10,
                      top: '50%',
                      transform: 'translateY(-50%)',
                    }}
                  >
                    <Loader2
                      className="h-4 w-4 animate-spin"
                      style={{ color: 'var(--primary-color)' }}
                    />
                  </div>
                )}
              </div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                {t('detail.addrCepHint')}
              </p>
            </div>
            <div className="space-y-1">
              <Label>{t('detail.addrStreet')}</Label>
              <Input
                placeholder={t('detail.addrStreetPlaceholder')}
                value={adrLogradouro}
                onChange={(e) => setAdrLogradouro(e.target.value)}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.75rem' }}>
              <div className="space-y-1">
                <Label>{t('detail.addrNumber')}</Label>
                <Input
                  placeholder="123"
                  value={adrNumero}
                  onChange={(e) => setAdrNumero(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>{t('detail.addrComplement')}</Label>
                <Input
                  placeholder={t('detail.addrComplementPlaceholder')}
                  value={adrComplemento}
                  onChange={(e) => setAdrComplemento(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>{t('detail.addrNeighborhood')}</Label>
              <Input
                placeholder={t('detail.addrNeighborhoodPlaceholder')}
                value={adrBairro}
                onChange={(e) => setAdrBairro(e.target.value)}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem' }}>
              <div className="space-y-1">
                <Label>{t('detail.addrCity')}</Label>
                <Input
                  placeholder={t('detail.addrCityPlaceholder')}
                  value={adrCidade}
                  onChange={(e) => setAdrCidade(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>{t('detail.addrState')}</Label>
                <Input
                  placeholder={t('detail.addrStatePlaceholder')}
                  maxLength={2}
                  value={adrEstado}
                  onChange={(e) => setAdrEstado(e.target.value.toUpperCase())}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setAddrModalOpen(false);
                resetAddrForm();
              }}
            >
              {tc('actions.cancel')}
            </Button>
            <Button onClick={handleAddrSubmit} disabled={addrLoading}>
              {addrLoading && <Spinner size="sm" />}{' '}
              {addrEditing ? tc('actions.save') : tc('actions.add')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Address Delete Confirm */}
      <AlertDialog
        open={addrDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setAddrDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('detail.removeAddress')}</AlertDialogTitle>
            <AlertDialogDescription>{t('detail.removeAddressConfirm')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleAddrDelete}>{tc('actions.delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default ClienteEnderecosSection;
