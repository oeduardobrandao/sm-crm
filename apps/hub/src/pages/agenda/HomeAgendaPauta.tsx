import { Link } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowRight, CalendarDays, ChevronRight } from 'lucide-react';
import { hubAgendaQuery } from '../../queries';
import { StatusPill } from '../../components/StatusPill';
import { SectionHeader } from '../../components/SectionHeader';
import { compararInicio, quando } from './formatar';
import { localeDe, selo, textoQuando } from './AgendaCard';

const MAX_ITENS = 3;

/** Pauta Home: one card, always present while the Agenda feature is on (the
 * classic HomeAgenda returns null without events). Same query as the page. */
export function HomeAgendaPauta({
  token,
  base,
  number,
}: {
  token: string;
  base: string;
  number: number;
}) {
  const { t, i18n } = useTranslation('hubAgenda');
  const { t: tHome } = useTranslation('hubHome');
  const locale = localeDe(i18n.language);
  const { data, isPending } = useInfiniteQuery(hubAgendaQuery(token));

  const agora = Date.now();
  const proximos = (data?.pages[0]?.itens ?? [])
    .filter((i) => Date.parse(i.fim) > agora)
    .sort(compararInicio);
  const aguardando = proximos.filter((i) => i.resposta === null).length;

  return (
    <section className="hub-card p-5">
      <SectionHeader
        number={number}
        label={tHome('home.pauta.section.agenda', 'Agenda')}
        title={t('home.titulo', 'Próximos eventos')}
        action={
          <Link
            to={`${base}/agenda`}
            className="flex items-center gap-1 text-[13px] font-semibold hub-txt shrink-0 group"
          >
            {t('home.verAgenda', 'Ver agenda')}
            <ChevronRight
              size={14}
              className="hub-tx3 group-hover:translate-x-0.5 transition-transform"
            />
          </Link>
        }
      />
      {isPending ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin h-5 w-5 rounded-full border-2 hub-spinner" />
        </div>
      ) : (
        <>
          {aguardando > 0 && (
            <Link
              to={`${base}/agenda`}
              className="mb-2 flex items-center gap-2.5 px-3 py-2.5 rounded-[var(--hub-r-ctl)] text-[13px] font-medium hub-txt group"
              style={{ background: 'var(--hub-st-wait-bg)' }}
            >
              <CalendarDays size={15} strokeWidth={2} style={{ color: 'var(--hub-st-wait-fg)' }} />
              <span className="flex-1">{t('home.aguardando', { count: aguardando })}</span>
              <ArrowRight
                size={15}
                className="hub-tx3 group-hover:translate-x-0.5 transition-transform"
              />
            </Link>
          )}
          {proximos.length === 0 ? (
            <p className="py-6 text-center text-[13px] hub-tx3">
              {t('home.vazio', 'Nenhum evento nos próximos dias')}
            </p>
          ) : (
            <ul className="hub-divide">
              {proximos.slice(0, MAX_ITENS).map((item) => {
                const s = selo(item, false, t);
                return (
                  <li key={item.ocorrencia_id}>
                    <Link
                      to={`${base}/agenda?ocorrencia=${item.ocorrencia_id}`}
                      className="flex items-center gap-3 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-[14px] font-medium hub-txt truncate">
                          {item.titulo}
                        </div>
                        <div className="text-[12.5px] hub-tx3 mt-0.5">
                          {textoQuando(quando(item, locale), t, true)}
                        </div>
                      </div>
                      <StatusPill tone={s.tone} semantic={s.semantic}>
                        {s.texto}
                      </StatusPill>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
