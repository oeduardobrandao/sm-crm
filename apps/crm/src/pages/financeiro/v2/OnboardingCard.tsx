import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/context/AuthContext';
import { handleEntitlementMutationError } from '@/lib/entitlement-toast';
import { seedFinanceiro } from '@/store';
import { DiaInicioSelect } from './DiaInicioSelect';

/** Shown in place of the v2 screens until the workspace has run the seed. */
export default function OnboardingCard({ canEdit = true }: { canEdit?: boolean }) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const [dia, setDia] = useState(1);
  const [busy, setBusy] = useState(false);

  const montar = async () => {
    setBusy(true);
    try {
      await seedFinanceiro(dia);
      await qc.invalidateQueries({ queryKey: ['financeiro-v2'] });
      toast.success('Financeiro montado.');
    } catch (e) {
      if (!handleEntitlementMutationError(e, profile?.conta_id ?? null))
        toast.error('Erro ao montar o financeiro');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card mx-auto flex max-w-xl flex-col gap-4">
      <h2 className="text-lg font-semibold">Montar o financeiro a partir dos dados atuais</h2>
      <p className="text-sm text-muted-foreground">
        Vamos usar a mensalidade de cada cliente e o custo de cada pessoa da equipe. Nada é apagado.
      </p>
      {canEdit ? (
        <>
          <div className="flex flex-col gap-2">
            <Label htmlFor="financeiro-periodo-dia">O período financeiro começa no dia</Label>
            <DiaInicioSelect id="financeiro-periodo-dia" value={dia} onChange={setDia} />
          </div>
          <div>
            <Button onClick={montar} disabled={busy}>
              Montar a partir dos dados atuais
            </Button>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Peça a quem administra o workspace para montar o financeiro.
        </p>
      )}
    </section>
  );
}
