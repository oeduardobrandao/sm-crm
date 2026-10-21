import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Loader2 } from 'lucide-react';
import { useHub } from '../HubContext';
import { PageHeader } from '../components/PageHeader';
import { hubAgendaItemQuery, hubAgendaQuery, HUB_AGENDA_KEY } from '../queries';
import type { HubAgendaItem } from '../types';
import { AgendaCard, localeDe } from './agenda/AgendaCard';
import { agruparPorDia, compararInicio, formatarDiaTitulo, type GrupoDia } from './agenda/formatar';
import { ListSkeleton } from '../components/Skeleton';

function parseOcorrencia(raw: string | null): number | null {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return isNaN(n) || n <= 0 ? null : n;
}

export function AgendaPage() {
  const { t, i18n } = useTranslation('hubAgenda');
  const locale = localeDe(i18n.language);
  const { bootstrap, token } = useHub();
  const ativo = bootstrap.feature_agenda === true;
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const alvo = parseOcorrencia(searchParams.get('ocorrencia'));
  const [anterioresAbertos, setAnterioresAbertos] = useState(false);
  // One "now" per render pass so every card and both sections agree on past/future.
  const agora = Date.now();

  const lista = useInfiniteQuery({ ...hubAgendaQuery(token), enabled: ativo });
  const carregados = useMemo(() => lista.data?.pages.flatMap((p) => p.itens) ?? [], [lista.data]);
  const alvoCarregado = alvo !== null && carregados.some((i) => i.ocorrencia_id === alvo);

  // Deep link to an occurrence beyond the first page(s): fetch it on its own.
  const alvoQuery = useQuery({
    ...hubAgendaItemQuery(token, alvo ?? 0),
    enabled: ativo && alvo !== null && lista.isSuccess && !alvoCarregado,
  });

  const itens = useMemo(() => {
    const porId = new Map<number, HubAgendaItem>();
    for (const i of carregados) porId.set(i.ocorrencia_id, i);
    if (alvoQuery.data && !porId.has(alvoQuery.data.ocorrencia_id)) {
      porId.set(alvoQuery.data.ocorrencia_id, alvoQuery.data);
    }
    return [...porId.values()].sort(compararInicio);
  }, [carregados, alvoQuery.data]);

  const proximos = itens.filter((i) => Date.parse(i.fim) > agora);
  // Most recent first: the client looks back from today.
  const anteriores = itens.filter((i) => Date.parse(i.fim) <= agora).reverse();
  const alvoNosAnteriores = alvo !== null && anteriores.some((i) => i.ocorrencia_id === alvo);
  const mostrarAnteriores = anterioresAbertos || alvoNosAnteriores;
  const alvoIndisponivel = alvo !== null && !alvoCarregado && alvoQuery.isError;

  const header = (
    <PageHeader
      title={t('page.title', 'Agenda')}
      description={t('page.description', 'Eventos que a equipe compartilhou com você.')}
    />
  );

  if (!ativo) {
    return (
      <div className="max-w-3xl mx-auto hub-fade-up">
        {header}
        <p className="text-sm hub-tx2">
          {t('page.indisponivel', 'A agenda não está disponível neste portal.')}
        </p>
      </div>
    );
  }

  const grupos = (doTrecho: HubAgendaItem[]) =>
    agruparPorDia(doTrecho).map((g: GrupoDia) => (
      <section key={g.dia} aria-label={formatarDiaTitulo(g.dia, locale)} className="space-y-2.5">
        <h3 className="text-[12.5px] font-semibold uppercase tracking-wide hub-tx3 first-letter:uppercase">
          {formatarDiaTitulo(g.dia, locale)}
        </h3>
        {g.itens.map((item) => (
          <AgendaCard
            key={item.ocorrencia_id}
            item={item}
            token={token}
            agora={agora}
            highlighted={item.ocorrencia_id === alvo}
          />
        ))}
      </section>
    ));

  return (
    <div className="max-w-3xl mx-auto hub-fade-up">
      {header}

      {lista.isLoading ? (
        <ListSkeleton rows={3} />
      ) : lista.isError ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="font-display text-lg font-semibold hub-txt mb-1">
            {t('loadError.title', 'Erro ao carregar a agenda')}
          </p>
          <p className="text-sm hub-tx2 mb-6">{lista.error.message}</p>
          <button
            type="button"
            onClick={() => qc.invalidateQueries({ queryKey: [HUB_AGENDA_KEY, token] })}
            className="px-4 py-2 rounded-[var(--hub-r-ctl)] hub-btn-primary text-sm font-semibold transition-colors"
          >
            {t('loadError.retry', 'Tentar novamente')}
          </button>
        </div>
      ) : (
        <div className="space-y-8">
          {alvoIndisponivel && (
            <p role="status" className="hub-card px-4 py-3 text-[13.5px] hub-tx2">
              {t('deepLink.indisponivel', 'Este evento não está mais disponível.')}
            </p>
          )}

          {itens.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <p className="font-display text-lg font-semibold hub-txt mb-1">
                {t('empty.title', 'Nenhum evento por aqui ainda.')}
              </p>
              <p className="text-sm hub-tx2">
                {t(
                  'empty.description',
                  'Quando a equipe compartilhar um evento com você, ele aparece aqui.',
                )}
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-5">
                <h2 className="font-semibold text-[16px] tracking-tight hub-txt">
                  {t('secoes.proximos', 'Próximos')}
                </h2>
                {proximos.length === 0 ? (
                  <p className="text-sm hub-tx2">
                    {t('secoes.semProximos', 'Nenhum evento marcado daqui para frente.')}
                  </p>
                ) : (
                  grupos(proximos)
                )}
              </div>

              {lista.hasNextPage && (
                <div className="flex justify-center">
                  <button
                    type="button"
                    disabled={lista.isFetchingNextPage}
                    onClick={() => void lista.fetchNextPage()}
                    className="flex items-center gap-2 px-4 py-2 rounded-[var(--hub-r-ctl)] hub-btn-secondary text-sm font-semibold disabled:opacity-50"
                  >
                    {lista.isFetchingNextPage && (
                      <Loader2 size={15} className="animate-spin" aria-hidden="true" />
                    )}
                    {t('carregarMais', 'Carregar mais')}
                  </button>
                </div>
              )}

              {anteriores.length > 0 && (
                <div className="space-y-5">
                  <button
                    type="button"
                    aria-expanded={mostrarAnteriores}
                    onClick={() => setAnterioresAbertos((v) => !v)}
                    className="flex items-center gap-1.5 font-semibold text-[16px] tracking-tight hub-txt"
                  >
                    {t('secoes.anteriores', 'Anteriores ({{count}})', {
                      count: anteriores.length,
                    })}
                    <ChevronDown
                      size={16}
                      aria-hidden="true"
                      className={`hub-tx3 transition-transform ${mostrarAnteriores ? 'rotate-180' : ''}`}
                    />
                  </button>
                  {mostrarAnteriores && grupos(anteriores)}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
