import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useHub } from '../../HubContext';
import { hubLinhasQuery } from '../../queries';
import type { HubLinha } from '../../types';
import { LinhaCard } from './LinhaCard';
import { currentPeriodo } from './linhaWeeks';

/**
 * Past months already decided sit under "Anteriores". Everything else, the linhas waiting
 * for the client and the decided ones of this month or later, stays in view so the client
 * sees the outcome of what they just sent.
 */
export function splitLinhas(linhas: HubLinha[], now: Date = new Date()) {
  const current = currentPeriodo(now);
  const byPeriodo = (a: HubLinha, b: HubLinha) => a.periodo.localeCompare(b.periodo);
  const isPrevious = (l: HubLinha) =>
    l.status !== 'enviada' && l.periodo.slice(0, 7) < current.slice(0, 7);
  const main = linhas.filter((l) => !isPrevious(l));
  return {
    main: [
      ...main.filter((l) => l.status === 'enviada').sort(byPeriodo),
      ...main.filter((l) => l.status !== 'enviada').sort(byPeriodo),
    ],
    previous: linhas.filter(isPrevious).sort((a, b) => byPeriodo(b, a)),
  };
}

export function LinhaEditorialTab() {
  const { t } = useTranslation('hubLinha');
  const { token, bootstrap } = useHub();
  const { data, isLoading, isError } = useQuery(hubLinhasQuery(token));
  const [showPrevious, setShowPrevious] = useState(false);

  const { main, previous } = useMemo(() => splitLinhas(data?.linhas ?? []), [data?.linhas]);
  // The bar pins to the viewport bottom, so two editable cards would stack their bars.
  const floatingBar = main.filter((l) => l.status === 'enviada').length === 1;
  const agencia = bootstrap.workspace.name;

  // A failed refetch keeps the cached data: only treat the error as fatal with nothing to show.
  if (isLoading) {
    return <div aria-hidden className="h-48 rounded-xl hub-bg-soft animate-pulse" />;
  }
  if (isError && data === undefined) {
    return (
      <div className="py-20 text-center text-sm hub-tx2" role="alert">
        {t('erroCarregar')}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {main.length === 0 ? (
        <p className="py-10 text-center text-sm hub-tx2">{t('vazio')}</p>
      ) : (
        main.map((linha) => (
          <LinhaCard
            key={linha.id}
            linha={linha}
            token={token}
            agencia={agencia}
            floatingBar={floatingBar && linha.status === 'enviada'}
          />
        ))
      )}

      {previous.length > 0 && (
        <div>
          <button
            type="button"
            aria-expanded={showPrevious}
            onClick={() => setShowPrevious((v) => !v)}
            className="flex items-center gap-1.5 text-[13px] font-semibold hub-tx2"
          >
            <ChevronDown
              size={15}
              aria-hidden
              style={{
                transform: showPrevious ? undefined : 'rotate(-90deg)',
                transition: 'transform 150ms',
              }}
            />
            {t('anteriores')}
            <span className="hub-tx3 font-normal">{previous.length}</span>
          </button>
          {showPrevious && (
            <div className="mt-3 space-y-5">
              {previous.map((linha) => (
                <LinhaCard
                  key={linha.id}
                  linha={linha}
                  token={token}
                  agencia={agencia}
                  floatingBar={false}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
