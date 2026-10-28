import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/context/AuthContext';
import { handleEntitlementMutationError } from '@/lib/entitlement-toast';
import {
  getPeriodosEditaveis,
  salvarCliente,
  type PeriodoFinanceiro,
  type StatusClienteFinanceiro,
} from '@/store';
import { PeriodoSelect } from '../../financeiro/v2/PeriodoSelect';
import { avisarErroFinanceiro } from '../../financeiro/v2/erros';

function buildSchema(t: TFunction) {
  return z.object({
    valor: z
      .string()
      .trim()
      .refine(
        (v) => v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0,
        t('mensalidadeDialog.valueError'),
      ),
    dia: z
      .string()
      .trim()
      .refine(
        (v) => v === '' || (/^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 31),
        t('mensalidadeDialog.dayError'),
      ),
    status: z.enum(['ativo', 'pausado', 'encerrado']),
    valeDesde: z.string().min(1, t('mensalidadeDialog.periodRequired')),
  });
}
type FormValues = z.infer<ReturnType<typeof buildSchema>>;

const STATUS_OPTIONS: StatusClienteFinanceiro[] = ['ativo', 'pausado', 'encerrado'];

export interface MensalidadeInicial {
  valor_mensal: number;
  dia_pagamento: number | null;
  status: StatusClienteFinanceiro;
}

interface ClienteMensalidadeDialogProps {
  clienteId: number;
  /** Effective version today (or the legacy fields when the client has no version yet). */
  inicial: MensalidadeInicial;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Edits the client's monthly fee, payment day and status from a chosen period on
 * (`financeiro_cliente_salvar`). Needs `financeiro/editar`; the caller gates the entry point.
 */
export function ClienteMensalidadeDialog({
  clienteId,
  inicial,
  open,
  onOpenChange,
}: ClienteMensalidadeDialogProps) {
  const { t } = useTranslation('clients');
  const editaveis = useQuery({
    queryKey: ['financeiro-v2', 'editaveis'],
    queryFn: getPeriodosEditaveis,
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {editaveis.isSuccess && open ? (
        // Mounted only once the periods are known AND only while open (the query stays
        // successful from cache after closing, so `isSuccess` alone would keep the form
        // and its state alive across opens). Each open therefore reads fresh defaults.
        <MensalidadeForm
          clienteId={clienteId}
          inicial={inicial}
          periodos={editaveis.data}
          onOpenChange={onOpenChange}
        />
      ) : (
        <DialogContent style={{ maxWidth: 480 }}>
          <DialogHeader>
            <DialogTitle>{t('mensalidadeDialog.title')}</DialogTitle>
            <DialogDescription>{t('mensalidadeDialog.description')}</DialogDescription>
          </DialogHeader>
          {editaveis.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {t('mensalidadeDialog.periodsLoadError')}
            </p>
          ) : (
            <Spinner className="mx-auto" />
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}

function MensalidadeForm({
  clienteId,
  inicial,
  periodos,
  onOpenChange,
}: {
  clienteId: number;
  inicial: MensalidadeInicial;
  periodos: PeriodoFinanceiro[];
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('clients');
  const { t: tc } = useTranslation();
  const qc = useQueryClient();
  const { profile } = useAuth();
  const schema = useMemo(() => buildSchema(t), [t]);

  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      valor: String(inicial.valor_mensal),
      dia: inicial.dia_pagamento === null ? '' : String(inicial.dia_pagamento),
      status: inicial.status,
      valeDesde: periodos.find((p) => p.status === 'aberto')?.inicio ?? '',
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await salvarCliente(
        clienteId,
        values.valeDesde,
        Number(values.valor),
        values.dia === '' ? null : Number(values.dia),
        values.status,
      );
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['financeiro-v2'] }),
        qc.invalidateQueries({ queryKey: ['clientes'] }),
        qc.invalidateQueries({ queryKey: ['cliente', clienteId] }),
      ]);
      toast.success(t('mensalidadeDialog.saved'));
      onOpenChange(false);
    } catch (e) {
      if (!handleEntitlementMutationError(e, profile?.conta_id ?? null)) {
        avisarErroFinanceiro(e, t('mensalidadeDialog.saveError'), qc);
      }
    }
  });

  const statusAtual = useWatch({ control, name: 'status' });

  return (
    <DialogContent
      style={{ maxWidth: 480 }}
      confirmClose={isDirty}
      onConfirmClose={() => onOpenChange(false)}
    >
      <DialogHeader>
        <DialogTitle>{t('mensalidadeDialog.title')}</DialogTitle>
        <DialogDescription>{t('mensalidadeDialog.description')}</DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit} className="space-y-3" noValidate>
        <div className="space-y-1">
          <Label htmlFor="mensalidade-valor">{t('mensalidadeDialog.valueLabel')}</Label>
          <Input
            id="mensalidade-valor"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            aria-invalid={errors.valor ? true : undefined}
            {...register('valor')}
          />
          {errors.valor && <p className="text-xs text-destructive">{errors.valor.message}</p>}
        </div>
        <div className="space-y-1">
          <Label htmlFor="mensalidade-dia">{t('mensalidadeDialog.dayLabel')}</Label>
          <Input
            id="mensalidade-dia"
            type="number"
            inputMode="numeric"
            min={1}
            max={31}
            placeholder="1-31"
            aria-invalid={errors.dia ? true : undefined}
            {...register('dia')}
          />
          {errors.dia && <p className="text-xs text-destructive">{errors.dia.message}</p>}
        </div>
        <div className="space-y-1">
          <Label htmlFor="mensalidade-status">{t('mensalidadeDialog.statusLabel')}</Label>
          <Controller
            control={control}
            name="status"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="mensalidade-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {tc(`status.${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {statusAtual === 'encerrado' && (
            <p className="text-xs text-muted-foreground">{t('mensalidadeDialog.closedHint')}</p>
          )}
        </div>
        <div className="space-y-1">
          <Label htmlFor="mensalidade-vale">{t('mensalidadeDialog.validFrom')}</Label>
          <Controller
            control={control}
            name="valeDesde"
            render={({ field }) => (
              <PeriodoSelect
                id="mensalidade-vale"
                value={field.value || undefined}
                onChange={field.onChange}
                periodos={periodos}
                ordem="cronologica"
                className="sm:w-full"
              />
            )}
          />
          {errors.valeDesde && (
            <p className="text-xs text-destructive">{errors.valeDesde.message}</p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('actions.cancel')}
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Spinner size="sm" />} {t('actions.save')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

export default ClienteMensalidadeDialog;
