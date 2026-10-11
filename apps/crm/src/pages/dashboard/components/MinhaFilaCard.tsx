import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, ListChecks } from 'lucide-react';
import { ListSkeleton } from '@/components/ui/skeletons';
import { formatEtapaPrazo } from '../../entregas/etapaPrazo';
import { formatPostDate } from '@/utils/postDate';
import { captureEvent } from '@/lib/analytics';
import {
  MINHA_FILA_MAX_ROWS as MAX_ROWS,
  minhaFilaItemHref as itemHref,
  prazoClass,
  useMinhaFilaTeaser,
} from '../useMinhaFilaTeaser';

/**
 * Teaser "Minha fila" do Dashboard (spec 2026-09-23 § Teaser): os três
 * primeiros itens da mesma fila de Entregas, para qualquer papel. Sem membro
 * vinculado vira o card "vincule seu usuário". Queries component-local.
 */
export function MinhaFilaCard() {
  const { t } = useTranslation('dashboard');
  const { canManageTeam, membroId, state, fila } = useMinhaFilaTeaser();

  const title = (
    <div className="today-head" style={{ marginBottom: '0.75rem' }}>
      <h3 className="today-title">
        <ListChecks className="h-4 w-4" aria-hidden />
        {t('minhaFila.title', 'Minha fila')}
      </h3>
      {membroId != null && (
        <Link
          to="/entregas?view=fila"
          className="today-cal-link"
          onClick={() =>
            captureEvent(
              'minha_fila_teaser_clicked',
              { target: 'ver_fila' },
              { sendInstantly: true },
            )
          }
        >
          {t('minhaFila.verFila', 'Ver minha fila')}{' '}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      )}
    </div>
  );

  let body: ReactNode;
  if (state === 'error') {
    body = (
      <p className="today-note">
        {t('minhaFila.erro', 'Não foi possível carregar a fila. Recarregue a página.')}
      </p>
    );
  } else if (state === 'loading') {
    body = <ListSkeleton rows={3} />;
  } else if (state === 'no-membro') {
    body = canManageTeam ? (
      <p className="today-note">
        {t(
          'minhaFila.semMembro',
          'Vincule seu usuário a um membro da equipe para ver sua fila aqui.',
        )}{' '}
        <Link to="/equipe" style={{ fontWeight: 600 }}>
          {t('minhaFila.abrirEquipe', 'Vincular na Equipe')}
        </Link>
      </p>
    ) : (
      <p className="today-note">
        {t(
          'minhaFila.semMembroAgent',
          'Peça a um administrador para vincular seu usuário na página Equipe.',
        )}
      </p>
    );
  } else if (state === 'empty') {
    body = <p className="today-note">{t('minhaFila.vazio', 'Nada na sua fila.')}</p>;
  } else {
    const rows = fila.items.slice(0, MAX_ROWS);
    const rest = fila.items.length - rows.length;
    body = (
      <>
        <div className="today-list">
          {rows.map((item, position) => (
            <Link
              key={item.key}
              to={itemHref(item)}
              className="today-row"
              onClick={() =>
                captureEvent(
                  'minha_fila_teaser_clicked',
                  { target: 'item', position },
                  { sendInstantly: true },
                )
              }
            >
              <span className="today-row-title">{item.post.titulo}</span>
              <span className="today-row-context">{item.post.cliente_nome}</span>
              <span className="today-row-end">
                {item.prazoDate && (
                  <span className={`board-card-deadline ${prazoClass(item.deadline)}`}>
                    {formatEtapaPrazo(item.deadline).label}
                  </span>
                )}
                <span className="today-row-context">
                  {item.post.scheduled_at
                    ? t('minhaFila.publica', { data: formatPostDate(item.post.scheduled_at) })
                    : t('minhaFila.semData', 'sem data de publicação')}
                </span>
              </span>
            </Link>
          ))}
        </div>
        {rest > 0 && (
          <p className="today-note" style={{ marginTop: '0.5rem' }}>
            {t('minhaFila.mais', { n: rest })}
          </p>
        )}
      </>
    );
  }

  return (
    <div className="card today-card animate-up" data-testid="minha-fila-card">
      {title}
      {body}
    </div>
  );
}
