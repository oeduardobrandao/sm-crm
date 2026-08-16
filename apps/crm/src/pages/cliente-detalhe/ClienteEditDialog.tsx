import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
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
import { updateCliente, type Cliente } from '../../store';
import { useAuth } from '../../context/AuthContext';
import { stripFinancialFields } from '@/lib/financialAccess';

interface ClienteEditDialogProps {
  cliente: Cliente;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ClienteEditDialog({ cliente, open, onOpenChange }: ClienteEditDialogProps) {
  const { t } = useTranslation('clients');
  const { t: tc } = useTranslation();
  const queryClient = useQueryClient();
  const { canSeeFinancials } = useAuth();

  const [saving, setSaving] = useState(false);
  const [fNome, setFNome] = useState('');
  const [fEmail, setFEmail] = useState('');
  const [fTelefone, setFTelefone] = useState('');
  const [fPlano, setFPlano] = useState('');
  const [fValor, setFValor] = useState('');
  const [fNotion, setFNotion] = useState('');
  const [fDiaPag, setFDiaPag] = useState('');
  const [fDiaEntrega, setFDiaEntrega] = useState('');
  const [fStatus, setFStatus] = useState<Cliente['status']>('ativo');
  const [fEspecialidade, setFEspecialidade] = useState('');
  const [fAniMes, setFAniMes] = useState(''); // '01'–'12'
  const [fAniDia, setFAniDia] = useState(''); // '01'–'31'

  // Re-seed the form every time the dialog opens (or the underlying cliente
  // changes while open), so stale edits from a previous open never linger.
  useEffect(() => {
    if (!open) return;
    setFNome(cliente.nome);
    setFEmail(cliente.email || '');
    setFTelefone(cliente.telefone || '');
    setFPlano(cliente.plano || '');
    setFValor(cliente.valor_mensal ? String(cliente.valor_mensal) : '');
    setFNotion(cliente.notion_page_url || '');
    setFDiaPag(cliente.data_pagamento ? String(cliente.data_pagamento) : '');
    setFDiaEntrega(cliente.dia_entrega ? String(cliente.dia_entrega) : '');
    setFStatus(cliente.status);
    setFEspecialidade(cliente.especialidade || '');
    const [aniMes = '', aniDia = ''] = (cliente.data_aniversario || '').split('-');
    setFAniMes(aniMes);
    setFAniDia(aniDia);
  }, [open, cliente]);

  // The dialog can hold a valor_mensal value in its form state. On live
  // revocation of financial access, close it rather than let the value linger.
  useEffect(() => {
    if (open && canSeeFinancials !== true) onOpenChange(false);
  }, [open, canSeeFinancials, onOpenChange]);

  const handleSubmit = async () => {
    if (!fNome) {
      toast.error(t('detail.nameRequired'));
      return;
    }
    const diaPag = fDiaPag ? parseInt(fDiaPag, 10) : undefined;
    if (diaPag !== undefined && (isNaN(diaPag) || diaPag < 1 || diaPag > 31)) {
      toast.error(t('detail.paymentDayRange'));
      return;
    }
    const diaEntrega = fDiaEntrega ? parseInt(fDiaEntrega, 10) : undefined;
    if (diaEntrega !== undefined && (isNaN(diaEntrega) || diaEntrega < 1 || diaEntrega > 31)) {
      toast.error(t('detail.deliveryDayRange'));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        nome: fNome,
        email: fEmail,
        telefone: fTelefone,
        plano: fPlano,
        valor_mensal: fValor ? Number(fValor) : undefined,
        notion_page_url: fNotion,
        data_pagamento: diaPag,
        dia_entrega: diaEntrega,
        status: fStatus,
        especialidade: fEspecialidade,
        data_aniversario: fAniMes && fAniDia ? `${fAniMes}-${fAniDia}` : null,
      };
      await updateCliente(
        cliente.id!,
        stripFinancialFields(payload, canSeeFinancials, ['valor_mensal']),
      );
      queryClient.invalidateQueries({ queryKey: ['cliente', cliente.id] });
      queryClient.invalidateQueries({ queryKey: ['clientes'] });
      onOpenChange(false);
      toast.success(t('detail.clientUpdated'));
    } catch (err: unknown) {
      toast.error(t('detail.saveError', { error: (err as Error).message }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent style={{ maxWidth: 600 }} onConfirmClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>{t('detail.editClient')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>{t('detail.formName')}</Label>
            <Input value={fNome} onChange={(e) => setFNome(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{t('detail.formEmail')}</Label>
            <Input type="email" value={fEmail} onChange={(e) => setFEmail(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{t('detail.formPhone')}</Label>
            <Input value={fTelefone} onChange={(e) => setFTelefone(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{t('detail.formPlan')}</Label>
            <Input value={fPlano} onChange={(e) => setFPlano(e.target.value)} />
          </div>
          {canSeeFinancials === true && (
            <div className="space-y-1">
              <Label>{t('detail.formMonthlyValue')}</Label>
              <Input type="number" value={fValor} onChange={(e) => setFValor(e.target.value)} />
            </div>
          )}
          <div className="space-y-1">
            <Label>{t('detail.formNotionUrl')}</Label>
            <Input value={fNotion} onChange={(e) => setFNotion(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{t('detail.formPaymentDay')}</Label>
            <Input
              type="number"
              min={1}
              max={31}
              value={fDiaPag}
              onChange={(e) => setFDiaPag(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>{t('detail.formDeliveryDay')}</Label>
            <Input
              type="number"
              min={1}
              max={31}
              value={fDiaEntrega}
              onChange={(e) => setFDiaEntrega(e.target.value)}
              placeholder="1-31"
            />
          </div>
          <div className="space-y-1">
            <Label>{t('detail.formStatus')}</Label>
            <Select value={fStatus} onValueChange={(v) => setFStatus(v as Cliente['status'])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ativo">{tc('status.ativo')}</SelectItem>
                <SelectItem value="pausado">{tc('status.pausado')}</SelectItem>
                <SelectItem value="encerrado">{tc('status.encerrado')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{t('detail.formSpecialty')}</Label>
            <Input value={fEspecialidade} onChange={(e) => setFEspecialidade(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{t('detail.formBirthday')}</Label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              <Select value={fAniMes} onValueChange={setFAniMes}>
                <SelectTrigger>
                  <SelectValue placeholder={t('detail.monthPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {Array.from(
                    { length: 12 },
                    (_, i) =>
                      [String(i + 1).padStart(2, '0'), tc(`months.${i}`)] as [string, string],
                  ).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={fAniDia} onValueChange={setFAniDia}>
                <SelectTrigger>
                  <SelectValue placeholder={t('detail.dayPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0')).map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tc('actions.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving && <Spinner size="sm" />} {tc('actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
