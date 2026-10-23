import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/context/AuthContext';
import { formatFinancialBRL } from '@/lib/financialAccess';
import { getFuncoes, type AcordoVersao, type Membro } from '@/store';
import { regraTexto } from '../financeiro/v2/format';
import { AcordoDialog } from './AcordoDialog';
import {
  dataCurta,
  metaPorMes,
  MODELO_LABEL,
  periodoLabel,
  rotuloValeDesde,
  unidadeComNumero,
  useAcordoAtual,
} from './acordoHelpers';

function metaTexto(a: AcordoVersao): string | null {
  if (a.modelo !== 'mensal_meta' || !a.meta_quantidade || !a.meta_periodo) return null;
  const unidade = unidadeComNumero(a.unidade ?? 'entrega', a.meta_quantidade);
  const mensal = metaPorMes(a.meta_quantidade, a.meta_periodo);
  if (a.meta_periodo === 'mes') return `${a.meta_quantidade} ${unidade} por mês`;
  return `${a.meta_quantidade} ${unidade} por ${periodoLabel(a.meta_periodo)}, cerca de ${mensal} por mês`;
}

function vigenciaTexto(a: AcordoVersao): string {
  if (a.vigencia_inicio && a.vigencia_fim) {
    return `${dataCurta(a.vigencia_inicio)} a ${dataCurta(a.vigencia_fim)}`;
  }
  if (a.vigencia_inicio) return `Desde ${dataCurta(a.vigencia_inicio)}`;
  if (a.vigencia_fim) return `Até ${dataCurta(a.vigencia_fim)}`;
  return 'Sem prazo definido';
}

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}

/** The member's working agreement as of the current period, with its history. */
export function AcordoCard({ membro }: { membro: Membro }) {
  const membroId = membro.id as number;
  const { canSeeFinancials, can } = useAuth();
  const canEdit = can('financeiro', 'editar') === true;
  const [dialogOpen, setDialogOpen] = useState(false);
  const { payload, versoes, atual, isLoading, isError } = useAcordoAtual(membroId);
  const funcoes = useQuery({ queryKey: ['financeiro-v2', 'funcoes'], queryFn: getFuncoes });

  // Not seeded yet: the Financeiro screen owns the onboarding.
  if (!isLoading && !isError && !payload) return null;

  const funcaoNome = atual?.funcao_id
    ? (funcoes.data?.find((f) => f.id === atual.funcao_id)?.nome ?? '-')
    : 'Sem função';
  const anteriores = atual ? versoes.filter((v) => v.vale_desde < atual.vale_desde) : [];
  const atendidos = (payload?.clientes ?? []).flatMap((c) => {
    const pessoa = c.pessoas.find((p) => p.membro_id === membroId);
    return pessoa ? [{ cliente: c, pessoa }] : [];
  });
  const meta = atual ? metaTexto(atual) : null;

  return (
    <section className="card" style={{ marginBottom: '1.5rem' }} aria-label="Acordo de trabalho">
      <div className="flex items-center justify-between gap-3" style={{ marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>Acordo</h3>
        {canEdit && !isLoading && !isError && (
          <Button variant="outline" onClick={() => setDialogOpen(true)}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
            {atual ? 'Editar acordo' : 'Cadastrar acordo'}
          </Button>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : isError ? (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível carregar o acordo.
        </p>
      ) : !atual ? (
        <p className="text-sm text-muted-foreground">Sem acordo cadastrado.</p>
      ) : (
        <>
          <dl className="grid gap-4 sm:grid-cols-3">
            <Linha rotulo="Função">{funcaoNome}</Linha>
            <Linha rotulo="Modelo">{MODELO_LABEL[atual.modelo]}</Linha>
            <Linha rotulo={atual.modelo === 'por_entrega' ? 'Valor por entrega' : 'Valor'}>
              {formatFinancialBRL(atual.valor, canSeeFinancials)}
              {atual.modelo === 'por_entrega' ? '' : ' por mês'}
            </Linha>
            <Linha rotulo="Dia de pagamento">{atual.dia_pagamento ?? 'Não definido'}</Linha>
            {meta && <Linha rotulo="Meta">{meta}</Linha>}
            {atual.modelo === 'mensal_limite' && atual.limite_clientes != null && (
              <Linha rotulo="Limite">até {atual.limite_clientes} clientes</Linha>
            )}
            <Linha rotulo="Vigência">{vigenciaTexto(atual)}</Linha>
            {/* Task 15 wires the upload and the open link; the path is already stored. */}
            <Linha rotulo="Contrato">Nenhum arquivo</Linha>
          </dl>

          <div style={{ marginTop: 16 }}>
            <h4 className="text-sm font-semibold" style={{ marginBottom: 8 }}>
              Clientes atendidos
            </h4>
            {atendidos.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum cliente atribuído neste período.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {atendidos.map(({ cliente, pessoa }) => (
                  <li
                    key={cliente.cliente_id}
                    className="flex items-baseline justify-between gap-3"
                  >
                    <span className="text-sm">{cliente.nome}</span>
                    <span className="text-sm text-muted-foreground">
                      {pessoa.regra === 'entrega'
                        ? regraTexto(pessoa, canSeeFinancials, atual.unidade ?? undefined)
                        : formatFinancialBRL(pessoa.valor, canSeeFinancials)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {anteriores.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h4 className="text-sm font-semibold" style={{ marginBottom: 8 }}>
                Histórico
              </h4>
              <ul className="flex flex-col gap-1">
                {anteriores.map((v) => (
                  <li key={v.id} className="flex items-baseline justify-between gap-3">
                    <span className="text-sm">{rotuloValeDesde(v.vale_desde)}</span>
                    <span className="text-sm text-muted-foreground">
                      {formatFinancialBRL(v.valor, canSeeFinancials)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {canEdit && (
        <AcordoDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          membro={membro}
          atual={atual}
        />
      )}
    </section>
  );
}

export default AcordoCard;
