import { useState } from 'react';
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
import type { MembroRentabilidade, ModeloAcordo } from '@/store';
import PeriodoSelect from './PeriodoSelect';

const MODELO_LABEL: Record<ModeloAcordo, string> = {
  mensal_meta: 'Mensal com meta',
  mensal_limite: 'Mensal com limite',
  por_entrega: 'Por entrega',
};

/** "15 de 20" for a mensal_limite member with a limit, the bare count otherwise. */
function clientesTexto(m: MembroRentabilidade): string {
  if (m.modelo === 'mensal_limite' && m.limite_clientes !== null) {
    return `${m.n_clientes} de ${m.limite_clientes}`;
  }
  return String(m.n_clientes);
}

/**
 * Financeiro › Custos da equipe: one row per member with the cost of the period and how it
 * spreads over their clients. Renders inside the layout's `.page-content`.
 */
export default function CustosEquipePage() {
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
          aria-label="Período"
          value={inicio}
          onChange={setInicio}
          periodos={periodos.data ?? []}
        />
        <p role="alert" className="text-sm text-muted-foreground">
          Não foi possível carregar os custos da equipe. Tente novamente em instantes.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => rentabilidade.refetch()}>
            Tentar novamente
          </Button>
          {inicio !== undefined && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setInicio(undefined)}>
              Voltar ao período atual
            </Button>
          )}
        </div>
      </div>
    );
  }
  if (!data) {
    return <p className="text-sm text-muted-foreground">Carregando...</p>;
  }
  // The layout shows the onboarding card until the seed has run.
  if (!data.seeded) return null;

  const money = (v: number | null) => formatFinancialBRL(v, canSeeFinancials);
  const funcaoNome = (id: number | null) => data.funcoes.find((f) => f.id === id)?.nome;
  const { totais } = data;

  return (
    <div className="space-y-4">
      <PeriodoSelect
        aria-label="Período"
        value={data.periodo.inicio}
        onChange={setInicio}
        periodos={periodos.data ?? []}
      />

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pessoa</TableHead>
              <TableHead>Função</TableHead>
              <TableHead>Modelo</TableHead>
              <TableHead className="text-right">Custo no período</TableHead>
              <TableHead className="text-right">Clientes</TableHead>
              <TableHead className="text-right">Por cliente</TableHead>
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
                        Sem função
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{MODELO_LABEL[m.modelo]}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {aInformar ? (
                      <Link to={`/equipe/${m.membro_id}`}>Entregas a informar</Link>
                    ) : (
                      money(m.custo)
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{clientesTexto(m)}</TableCell>
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
                Total
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
          Sem cliente: {money(totais.custo_sem_cliente)}
        </p>
      )}
    </div>
  );
}
