import { Link } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowRight, CalendarDays, ChevronRight } from 'lucide-react';
import { hubAgendaQuery } from '../../queries';
import { StatusPill } from '../../components/StatusPill';
import { compararInicio, quando } from './formatar';
import { localeDe, selo, textoQuando } from './AgendaCard';

const MAX_ITENS = 3;

/**
 * Home: the pending-answer notice and the "Próximos eventos" block. Reads the
 * same infinite query as the Agenda page (first page only), so opening the
 * page right after costs no extra request. Renders nothing without upcoming
 * events: the nav item is how the client finds an empty agenda.
 */
export function HomeAgenda({ token, base }: { token: string; base: string }) {
  const { t, i18n } = useTranslation('hubAgenda');
  const locale = localeDe(i18n.language);
  const { data } = useInfiniteQuery(hubAgendaQuery(token));

  const agora = Date.now();
  const proximos = (data?.pages[0]?.itens ?? [])
    .filter((i) => Date.parse(i.fim) > agora)
    .sort(compararInicio);
  if (proximos.length === 0) return null;

  const aguardando = proximos.filter((i) => i.resposta === null).length;

  return (
    <>
      {aguardando > 0 && (
        <Link
          to={`${base}/agenda`}
          className="hub-fade-up w-full flex items-center gap-3 px-5 py-3.5 rounded-2xl text-left group transition-shadow hover:shadow-sm"
          style={{
            background: 'color-mix(in srgb, var(--hub-txt) 5%, transparent)',
            border: '1px solid color-mix(in srgb, var(--hub-txt) 14%, transparent)',
          }}
        >
          <span
            className="flex items-center justify-center w-8 h-8 rounded-full flex-shrink-0"
            style={{
              background: 'color-mix(in srgb, var(--hub-txt) 10%, transparent)',
              color: 'var(--hub-txt)',
            }}
          >
            <CalendarDays size={16} strokeWidth={2} />
          </span>
          <span className="flex-1 text-sm font-medium hub-txt">
            {aguardando === 1
              ? t('home.aguardando_one', 'Você tem 1 evento aguardando sua resposta')
              : t('home.aguardando_other', 'Você tem {{count}} eventos aguardando sua resposta', {
                  count: aguardando,
                })}
          </span>
          <ArrowRight
            size={16}
            className="hub-tx3 group-hover:translate-x-0.5 transition-transform flex-shrink-0"
          />
        </Link>
      )}

      <section className="hub-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-[16px] tracking-tight hub-txt">
              {t('home.titulo', 'Próximos eventos')}
            </h3>
            <div className="text-[12.5px] hub-tx3 mt-0.5">
              {t('home.subtitulo', 'Compartilhados pela equipe')}
            </div>
          </div>
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
        </div>
        <ul className="mt-3 hub-divide">
          {proximos.slice(0, MAX_ITENS).map((item) => {
            const s = selo(item, false, t);
            return (
              <li key={item.ocorrencia_id}>
                <Link
                  to={`${base}/agenda?ocorrencia=${item.ocorrencia_id}`}
                  className="flex items-center gap-3 py-3 group"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-medium hub-txt truncate">{item.titulo}</div>
                    <div className="text-[12.5px] hub-tx3 mt-0.5">
                      {textoQuando(quando(item, locale), t, true)}
                    </div>
                  </div>
                  <StatusPill tone={s.tone}>{s.texto}</StatusPill>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
