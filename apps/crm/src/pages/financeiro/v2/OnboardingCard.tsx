import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/context/AuthContext';
import { handleEntitlementMutationError } from '@/lib/entitlement-toast';
import { seedFinanceiro } from '@/store';
import { DiaInicioSelect } from './DiaInicioSelect';
import { avisarErroFinanceiro } from './erros';

/** Shown in place of the v2 screens until the workspace has run the seed. */
export default function OnboardingCard({ canEdit = true }: { canEdit?: boolean }) {
  const { t } = useTranslation('financeV2');
  const qc = useQueryClient();
  const { profile } = useAuth();
  const [dia, setDia] = useState(1);
  const [busy, setBusy] = useState(false);

  const montar = async () => {
    setBusy(true);
    try {
      await seedFinanceiro(dia);
      await qc.invalidateQueries({ queryKey: ['financeiro-v2'] });
      toast.success(t('onboarding.sucesso'));
    } catch (e) {
      if (!handleEntitlementMutationError(e, profile?.conta_id ?? null))
        avisarErroFinanceiro(e, t('onboarding.erro'), qc);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card mx-auto flex max-w-xl flex-col gap-4">
      <h2 className="text-lg font-semibold">{t('onboarding.title')}</h2>
      <p className="text-sm text-muted-foreground">{t('onboarding.descricao')}</p>
      {canEdit ? (
        <>
          <div className="flex flex-col gap-2">
            <Label htmlFor="financeiro-periodo-dia">{t('onboarding.diaLabel')}</Label>
            <DiaInicioSelect id="financeiro-periodo-dia" value={dia} onChange={setDia} />
          </div>
          <div>
            <Button onClick={montar} disabled={busy}>
              {t('onboarding.montar')}
            </Button>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{t('onboarding.semPermissao')}</p>
      )}
    </section>
  );
}
