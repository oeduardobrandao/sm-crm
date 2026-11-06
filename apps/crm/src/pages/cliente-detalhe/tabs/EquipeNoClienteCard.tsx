import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/context/AuthContext';
import { handleEntitlementMutationError } from '@/lib/entitlement-toast';
import { formatFinancialBRL } from '@/lib/financialAccess';
import { getInitials } from '@/lib/initials';
import {
  getPeriodosEditaveis,
  salvarAtribuicoes,
  type AtribuicaoMudanca,
  type ClienteRentabilidade,
  type FuncaoFinanceira,
  type MembroRentabilidade,
} from '@/store';
import { regraTexto } from '../../financeiro/v2/format';
import { avisarErroFinanceiro } from '../../financeiro/v2/erros';

interface EquipeNoClienteCardProps {
  cliente: ClienteRentabilidade;
  funcoes: FuncaoFinanceira[];
  /** Every member with an acordo in the period; the candidates of each função. */
  membros: MembroRentabilidade[];
  /** `periodo.inicio` of the payload: the fallback "vale a partir de" for a change. */
  periodoInicio: string;
}

/**
 * "Equipe neste cliente": one group per função (payload order) with the people who serve
 * this client, what each costs it, and (with `financeiro/editar`) a select to swap someone
 * or pick the first person of an empty função. A change takes effect from the open period.
 */
export function EquipeNoClienteCard({
  cliente,
  funcoes,
  membros,
  periodoInicio,
}: EquipeNoClienteCardProps) {
  const { t } = useTranslation('clients');
  const { canSeeFinancials, can, profile } = useAuth();
  const qc = useQueryClient();
  // A paused client keeps its people (they come back when it resumes) but is not edited
  // here, like its disabled row in the matrix.
  const pausado = cliente.status === 'pausado';
  const canEdit = can('financeiro', 'editar') === true && !pausado;
  const [busy, setBusy] = useState(false);

  const editaveis = useQuery({
    queryKey: ['financeiro-v2', 'editaveis'],
    queryFn: getPeriodosEditaveis,
    enabled: canEdit,
  });
  const valeDesde = editaveis.data?.find((p) => p.status === 'aberto')?.inicio ?? periodoInicio;

  const aplicar = async (mudancas: AtribuicaoMudanca[]) => {
    setBusy(true);
    try {
      await salvarAtribuicoes(valeDesde, mudancas);
      await qc.invalidateQueries({ queryKey: ['financeiro-v2'] });
      toast.success(t('equipeCard.saved'));
    } catch (e) {
      if (!handleEntitlementMutationError(e, profile?.conta_id ?? null)) {
        avisarErroFinanceiro(e, t('equipeCard.saveError'), qc);
      }
    } finally {
      setBusy(false);
    }
  };

  const atribuidos = new Set(cliente.pessoas.map((p) => p.membro_id));

  return (
    <section className="card animate-up" style={{ marginBottom: '1.5rem' }}>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h3 className="text-xl font-bold tracking-tight text-foreground">
          {t('equipeCard.title')}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t('equipeCard.totalCost')}{' '}
          <strong className="text-foreground">
            {formatFinancialBRL(cliente.custo, canSeeFinancials)}
          </strong>
        </p>
      </div>
      {pausado && (
        <p className="mb-4 text-sm text-muted-foreground">{t('equipeCard.pausedHint')}</p>
      )}
      <div className="flex flex-col gap-4">
        {funcoes.map((funcao) => {
          const pessoas = cliente.pessoas.filter((p) => p.funcao_id === funcao.id);
          // Candidates: the função's members not already on this client.
          const candidatos = membros.filter(
            (m) => m.funcao_id === funcao.id && !atribuidos.has(m.membro_id),
          );
          return (
            <div
              key={funcao.id}
              role="group"
              aria-label={funcao.nome}
              className="flex flex-col gap-2"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {funcao.nome}
              </p>
              {pessoas.map((pessoa) => (
                <div
                  key={pessoa.membro_id}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-border px-3 py-2"
                >
                  <Avatar className="h-8 w-8 text-xs">
                    <AvatarFallback>{getInitials(pessoa.nome)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-foreground">{pessoa.nome}</span>
                      {pessoa.regra === 'exclusivo' && !pausado && (
                        <Badge variant="info" size="sm">
                          {t('equipeCard.exclusive')}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {regraTexto(pessoa, canSeeFinancials, undefined, pausado)}
                    </p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-foreground">
                    {formatFinancialBRL(pessoa.valor, canSeeFinancials)}
                  </span>
                  {canEdit && (
                    <Select
                      value=""
                      onValueChange={(novo) =>
                        void aplicar([
                          {
                            membro_id: pessoa.membro_id,
                            cliente_id: cliente.cliente_id,
                            ativo: false,
                          },
                          { membro_id: Number(novo), cliente_id: cliente.cliente_id, ativo: true },
                        ])
                      }
                      disabled={busy || candidatos.length === 0}
                    >
                      <SelectTrigger
                        className="w-32"
                        aria-label={t('equipeCard.swapAria', { name: pessoa.nome })}
                      >
                        <SelectValue placeholder={t('equipeCard.swap')} />
                      </SelectTrigger>
                      <SelectContent>
                        {candidatos.map((m) => (
                          <SelectItem key={m.membro_id} value={String(m.membro_id)}>
                            {m.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              ))}
              {pessoas.length === 0 &&
                (canEdit ? (
                  <Select
                    value=""
                    onValueChange={(novo) =>
                      void aplicar([
                        { membro_id: Number(novo), cliente_id: cliente.cliente_id, ativo: true },
                      ])
                    }
                    disabled={busy || candidatos.length === 0}
                  >
                    <SelectTrigger
                      className="w-full sm:w-56"
                      aria-label={t('equipeCard.pickAria', { role: funcao.nome })}
                    >
                      <SelectValue placeholder={t('equipeCard.pick')} />
                    </SelectTrigger>
                    <SelectContent>
                      {candidatos.map((m) => (
                        <SelectItem key={m.membro_id} value={String(m.membro_id)}>
                          {m.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-sm text-muted-foreground">{t('equipeCard.empty')}</p>
                ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default EquipeNoClienteCard;
