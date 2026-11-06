import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { i18n } from '@mesaas/i18n';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/context/AuthContext';
import { formatFinancialBRL } from '@/lib/financialAccess';
import { getFuncoes, urlContratoAcordo, type AcordoVersao, type Membro } from '@/store';
import { regraTexto } from '../financeiro/v2/format';
import { AcordoDialog } from './AcordoDialog';
import {
  contratoRotulo,
  dataCurta,
  metaPorMes,
  modeloLabel,
  periodoLabel,
  rotuloValeDesde,
  unidadeComNumero,
  useAcordoAtual,
} from './acordoHelpers';

function metaTexto(a: AcordoVersao): string | null {
  if (a.modelo !== 'mensal_meta' || !a.meta_quantidade || !a.meta_periodo) return null;
  // A stored unit is data (kept as typed); without one, the generic "entrega" is translated.
  const unidade =
    a.unidade != null
      ? unidadeComNumero(a.unidade, a.meta_quantidade)
      : i18n.t('member:acordoCard.entrega', { count: a.meta_quantidade });
  const mensal = metaPorMes(a.meta_quantidade, a.meta_periodo);
  if (a.meta_periodo === 'mes') {
    return i18n.t('member:acordoCard.metaMensal', { quantidade: a.meta_quantidade, unidade });
  }
  return i18n.t('member:acordoCard.metaPeriodo', {
    quantidade: a.meta_quantidade,
    unidade,
    periodo: periodoLabel(a.meta_periodo),
    mensal,
  });
}

function vigenciaTexto(a: AcordoVersao): string {
  if (a.vigencia_inicio && a.vigencia_fim) {
    return i18n.t('member:acordoCard.vigenciaIntervalo', {
      inicio: dataCurta(a.vigencia_inicio),
      fim: dataCurta(a.vigencia_fim),
    });
  }
  if (a.vigencia_inicio) {
    return i18n.t('member:acordoCard.vigenciaDesde', { data: dataCurta(a.vigencia_inicio) });
  }
  if (a.vigencia_fim) {
    return i18n.t('member:acordoCard.vigenciaAte', { data: dataCurta(a.vigencia_fim) });
  }
  return i18n.t('member:acordoCard.semPrazo');
}

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}

/**
 * Opens a signed (short-lived) contract url in a new tab. The tab is opened
 * synchronously inside the click so popup blockers allow it, then pointed at the
 * url once it resolves; `opener` is cut to get noopener semantics.
 */
async function abrirContrato(path: string) {
  const aba = window.open('', '_blank');
  if (!aba) {
    toast.error(i18n.t('member:acordoCard.popupBloqueado'));
    return;
  }
  aba.opener = null;
  try {
    aba.location.href = await urlContratoAcordo(path);
  } catch {
    aba.close();
    toast.error(i18n.t('member:acordoCard.erroAbrirContrato'));
  }
}

/** The member's working agreement as of the current period, with its history. */
export function AcordoCard({ membro }: { membro: Membro }) {
  const { t } = useTranslation('member');
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
    : t('shared.semFuncao');
  const anteriores = atual ? versoes.filter((v) => v.vale_desde < atual.vale_desde) : [];
  const atendidos = (payload?.clientes ?? []).flatMap((c) => {
    const pessoa = c.pessoas.find((p) => p.membro_id === membroId);
    return pessoa ? [{ cliente: c, pessoa }] : [];
  });
  const meta = atual ? metaTexto(atual) : null;

  return (
    <section
      className="card"
      style={{ marginBottom: '1.5rem' }}
      aria-label={t('acordoCard.ariaLabel')}
    >
      <div className="flex items-center justify-between gap-3" style={{ marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>{t('acordoCard.titulo')}</h3>
        {canEdit && !isLoading && !isError && (
          <Button variant="outline" onClick={() => setDialogOpen(true)}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
            {atual ? t('shared.editarAcordo') : t('shared.cadastrarAcordo')}
          </Button>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t('acordoCard.erroCarregar')}
        </p>
      ) : !atual ? (
        <p className="text-sm text-muted-foreground">{t('acordoCard.semAcordo')}</p>
      ) : (
        <>
          <dl className="grid gap-4 sm:grid-cols-3">
            <Linha rotulo={t('shared.funcao')}>{funcaoNome}</Linha>
            <Linha rotulo={t('acordoCard.modelo')}>{modeloLabel(atual.modelo)}</Linha>
            <Linha
              rotulo={
                atual.modelo === 'por_entrega' ? t('shared.valorPorEntrega') : t('acordoCard.valor')
              }
            >
              {formatFinancialBRL(atual.valor, canSeeFinancials)}
              {atual.modelo === 'por_entrega' ? '' : t('acordoCard.porMes')}
            </Linha>
            <Linha rotulo={t('shared.diaPagamento')}>
              {atual.dia_pagamento ?? t('acordoCard.naoDefinido')}
            </Linha>
            {meta && <Linha rotulo={t('acordoCard.meta')}>{meta}</Linha>}
            {atual.modelo === 'mensal_limite' && atual.limite_clientes != null && (
              <Linha rotulo={t('acordoCard.limite')}>
                {t('acordoCard.limiteClientes', { count: atual.limite_clientes })}
              </Linha>
            )}
            <Linha rotulo={t('acordoCard.vigencia')}>{vigenciaTexto(atual)}</Linha>
            <Linha rotulo={t('acordoCard.contrato')}>
              {atual.arquivo_path ? (
                <span className="flex flex-wrap items-center gap-2">
                  {contratoRotulo(atual.arquivo_path)}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void abrirContrato(atual.arquivo_path as string)}
                  >
                    <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    {t('acordoCard.abrir')}
                  </Button>
                </span>
              ) : (
                t('shared.nenhumArquivo')
              )}
            </Linha>
          </dl>

          <div style={{ marginTop: 16 }}>
            <h4 className="text-sm font-semibold" style={{ marginBottom: 8 }}>
              {t('acordoCard.clientesAtendidos')}
            </h4>
            {atendidos.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('shared.nenhumClienteAtribuido')}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {atendidos.map(({ cliente, pessoa }) => (
                  <li
                    key={cliente.cliente_id}
                    className="flex items-baseline justify-between gap-3"
                  >
                    <span className="text-sm">{cliente.nome}</span>
                    <span className="text-sm text-muted-foreground">
                      {pessoa.regra === 'entrega' || cliente.status === 'pausado'
                        ? regraTexto(
                            pessoa,
                            canSeeFinancials,
                            atual.unidade ?? undefined,
                            cliente.status === 'pausado',
                          )
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
                {t('acordoCard.historico')}
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
