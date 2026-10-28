import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/context/AuthContext';
import { formatFinancialBRL } from '@/lib/financialAccess';
import { getPeriodos, getRentabilidade } from '@/store';
import type { MembroRentabilidade } from '@/store';
import PeriodoSelect from './PeriodoSelect';

/** "15 de 20" for a mensal_limite member with a limit, the bare count otherwise. */
function clientesTexto(m: MembroRentabilidade, t: TFunction): string {
  if (m.modelo === 'mensal_limite' && m.limite_clientes !== null) {
    return t('shared.nDeLimite', { n: m.n_clientes, limite: m.limite_clientes });
  }
  return String(m.n_clientes);
}

/**
 * Financeiro › Custos da equipe: one row per member with the cost of the period and how it
 * spreads over their clients. Renders inside the layout's `.page-content`.
 */
export default function CustosEquipePage() {
  const { t } = useTranslation('financeV2');
  const { canSeeFinancials } = useAuth();
  const [inicio, setInicio] = useState<string | undefined>(undefined);

  const rentabilidade = useQuery({
    queryKey: ['financeiro-v2', 'rentabilidade', inicio ?? 'atual'],
    queryFn: () => getRentabilidade(inicio),
    placeholderData: keepPreviousData,
  });
  const periodos = useQuery({
    queryKey: ['financeiro-v2', 'periodos'],
    queryFn: getPeriodos,
  });

  const data = rentabilidade.data;
  if (rentabilidade.isError && !data) {
    // Keep the picker: a failed period must not trap the user on this line.
    return (
      <div className="space-y-4">
        <PeriodoSelect
          aria-label={t('shared.periodo')}
          value={inicio}
          onChange={setInicio}
          periodos={periodos.data ?? []}
        />
        <p role="alert" className="text-sm text-muted-foreground">
          {t('custos.loadError')}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => rentabilidade.refetch()}>
            {t('shared.tentarNovamente')}
          </Button>
          {inicio !== undefined && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setInicio(undefined)}>
              {t('shared.voltarAtual')}
            </Button>
          )}
        </div>
      </div>
    );
  }
  if (!data) {
    return <p className="text-sm text-muted-foreground">{t('custos.carregando')}</p>;
  }
  // The layout shows the onboarding card until the seed has run.
  if (!data.seeded) return null;

  const money = (v: number | null) => formatFinancialBRL(v, canSeeFinancials);
  const funcaoNome = (id: number | null) => data.funcoes.find((f) => f.id === id)?.nome;
  const { totais } = data;

  return (
    <div className="space-y-4">
      <PeriodoSelect
        aria-label={t('shared.periodo')}
        value={data.periodo.inicio}
        onChange={setInicio}
        periodos={periodos.data ?? []}
      />

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('custos.colPessoa')}</TableHead>
              <TableHead>{t('custos.colFuncao')}</TableHead>
              <TableHead>{t('custos.colModelo')}</TableHead>
              <TableHead className="text-right">{t('custos.colCusto')}</TableHead>
              <TableHead className="text-right">{t('shared.clientes')}</TableHead>
              <TableHead className="text-right">{t('shared.porCliente')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.membros.map((m) => {
              const funcao = funcaoNome(m.funcao_id);
              const aInformar = m.modelo === 'por_entrega' && m.a_informar;
              return (
                <TableRow key={m.membro_id}>
                  <TableCell className="font-medium">
                    <Link to={`/equipe/${m.membro_id}`}>{m.nome}</Link>
                  </TableCell>
                  <TableCell>
                    {funcao ?? (
                      <Badge variant="neutral" size="sm">
                        {t('shared.semFuncao')}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{t(`custos.modelo.${m.modelo}`)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {/* A delivery still to inform does not hide the cost already known. */}
                    {aInformar && m.custo > 0 ? (
                      <span className="inline-flex flex-wrap items-center justify-end gap-x-2">
                        {money(m.custo)}
                        <Link to={`/equipe/${m.membro_id}`} className="text-xs">
                          {t('shared.entregasAInformar')}
                        </Link>
                      </span>
                    ) : aInformar ? (
                      <Link to={`/equipe/${m.membro_id}`}>{t('shared.entregasAInformar')}</Link>
                    ) : (
                      money(m.custo)
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{clientesTexto(m, t)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {m.por_cliente === null || m.n_clientes === 0 ? '-' : money(m.por_cliente)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3} className="font-medium">
                {t('custos.total')}
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {money(totais.custo_total)}
              </TableCell>
              <TableCell colSpan={2} />
            </TableRow>
          </TableFooter>
        </Table>
      </div>

      {totais.custo_sem_cliente > 0 && (
        <p className="text-xs text-muted-foreground">
          {t('custos.semCliente', { valor: money(totais.custo_sem_cliente) })}
        </p>
      )}
    </div>
  );
}
