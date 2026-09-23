import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, ListChecks } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '../../../context/AuthContext';
import { useCurrentMembro } from '../../../hooks/useCurrentMembro';
import { useMinhaFilaData } from '../../entregas/hooks/useMinhaFilaData';
import { buildMinhaFila, EMPTY_FILA, type FilaItem } from '../../entregas/minhaFila';
import { formatEtapaPrazo, type DeadlineInfo } from '../../entregas/etapaPrazo';
import { formatPostDate } from '@/utils/postDate';
import { captureEvent } from '@/lib/analytics';

const MAX_ROWS = 3;

function prazoClass(deadline: DeadlineInfo): string {
  if (deadline.estourado) return 'deadline-overdue';
  if (deadline.urgente) return 'deadline-warning';
  return 'deadline-ok';
}

/** Mesmo deep link de todayAgenda.postHref, mais `view=fila` para cair na
 *  fila (consumeParams em EntregasPage só remove drawer/post). */
function itemHref(item: FilaItem): string {
  const p = item.post;
  return p.workflow_id != null
    ? `/entregas?view=fila&drawer=${p.workflow_id}&post=${p.id}`
    : `/entregas?view=fila&post=${p.id}`;
}

/**
 * Teaser "Minha fila" do Dashboard (spec 2026-09-23 § Teaser): os três
 * primeiros itens da mesma fila de Entregas, para qualquer papel. Sem membro
 * vinculado vira o card "vincule seu usuário". Queries component-local.
 */
export function MinhaFilaCard() {
  const { t } = useTranslation('dashboard');
  const { role, workspaceRole } = useAuth();
  const canManageTeam = (workspaceRole ?? role) !== 'agent';
  const { membro, isPending: membroPending, isError: membroError } = useCurrentMembro();
  const membroId = membro?.id ?? null;
  const data = useMinhaFilaData({ enabled: membroId != null });

  const fila = useMemo(
    () =>
      membroId != null
        ? buildMinhaFila(
            { cards: data.cards, posts: data.posts, postEntities: data.postEntities },
            membroId,
            new Date(),
          )
        : EMPTY_FILA,
    [membroId, data.cards, data.posts, data.postEntities],
  );

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
  if (membroError || (membroId != null && data.isError)) {
    // `data.isError` is gated by `membroId != null`, same as `data.isLoading`
    // below (fix round 2): the six queries are `enabled: membroId != null`, but
    // they read a SHARED cache keyed by e.g. ['active-posts'] -- a disabled
    // observer still reflects an error left over on that key from an earlier
    // load (Entregas, or a previous linked session). Without this gate, an
    // unlinked user would see "couldn't load" instead of "vincule seu usuário".
    // `membroError` is NOT gated: without the membros list we can't tell if the
    // user is linked at all, so it always wins.
    //
    // Checked before loading: a failed query with no cached data must win over a
    // sibling query that is merely paused (e.g. offline), or the card would spin
    // forever instead of surfacing the error (fix round 1, finding 2).
    body = (
      <p className="today-note">
        {t('minhaFila.erro', 'Não foi possível carregar a fila. Recarregue a página.')}
      </p>
    );
  } else if (membroPending || (membroId != null && data.isLoading)) {
    // `membroPending` (isPending: no data, no error yet), NOT the derived
    // `isLoading` (isPending && isFetching): a paused/offline cold start has
    // isLoading=false with no membro yet, which would otherwise fall through to
    // the no-membro branch below and wrongly show "vincule seu usuário" to a user
    // who IS linked (fix round 1, finding 1).
    body = (
      <div style={{ textAlign: 'center', padding: '1.5rem' }}>
        <Spinner size="md" />
      </div>
    );
  } else if (membroId == null) {
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
  } else if (fila.items.length === 0) {
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
