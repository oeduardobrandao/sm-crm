import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ListSkeleton } from '@/components/ui/skeletons';
import { formatPostDate } from '@/utils/postDate';
import { captureEvent } from '@/lib/analytics';
import { formatEtapaPrazo } from '../../entregas/etapaPrazo';
import {
  MINHA_FILA_MAX_ROWS,
  minhaFilaItemHref,
  prazoClass,
  useMinhaFilaTeaser,
} from '../useMinhaFilaTeaser';
import { PhoneSection } from './PhoneSection';

/** "Minha fila" teaser on phones: the first three items of the Entregas queue as a
 *  grouped section, with "Ver minha fila" next to the header. */
export function MinhaFilaPhone() {
  const { t } = useTranslation('dashboard');
  const { canManageTeam, membroId, state, fila } = useMinhaFilaTeaser();
  const title = t('minhaFila.title', 'Minha fila');

  const verFila =
    membroId != null ? (
      <Link
        to="/entregas?view=fila"
        className="phone-home-link"
        onClick={() =>
          captureEvent('minha_fila_teaser_clicked', { target: 'ver_fila' }, { sendInstantly: true })
        }
      >
        {t('minhaFila.verFila', 'Ver minha fila')}
      </Link>
    ) : null;

  if (state === 'loading') {
    return (
      <PhoneSection title={title} data-testid="minha-fila-phone">
        <li className="phone-home-row phone-home-row--pad">
          <ListSkeleton rows={3} />
        </li>
      </PhoneSection>
    );
  }

  if (state !== 'ready') {
    let note;
    if (state === 'error') {
      note = t('minhaFila.erro', 'Não foi possível carregar a fila. Recarregue a página.');
    } else if (state === 'empty') {
      note = t('minhaFila.vazio', 'Nada na sua fila.');
    } else if (canManageTeam) {
      note = (
        <>
          {t(
            'minhaFila.semMembro',
            'Vincule seu usuário a um membro da equipe para ver sua fila aqui.',
          )}{' '}
          <Link to="/equipe" className="phone-home-inline-link">
            {t('minhaFila.abrirEquipe', 'Vincular na Equipe')}
          </Link>
        </>
      );
    } else {
      note = t(
        'minhaFila.semMembroAgent',
        'Peça a um administrador para vincular seu usuário na página Equipe.',
      );
    }
    return (
      <PhoneSection title={title} trailing={verFila} data-testid="minha-fila-phone">
        <li className="phone-home-row phone-home-row--pad">
          <span className="phone-home-empty">{note}</span>
        </li>
      </PhoneSection>
    );
  }

  const rows = fila.items.slice(0, MINHA_FILA_MAX_ROWS);
  const rest = fila.items.length - rows.length;
  return (
    <PhoneSection
      title={title}
      trailing={verFila}
      footer={rest > 0 ? t('minhaFila.mais', { n: rest }) : undefined}
      data-testid="minha-fila-phone"
    >
      {rows.map((item, position) => (
        <li key={item.key} className="phone-home-row">
          <Link
            to={minhaFilaItemHref(item)}
            className="phone-home-row__link"
            onClick={() =>
              captureEvent(
                'minha_fila_teaser_clicked',
                { target: 'item', position },
                { sendInstantly: true },
              )
            }
          >
            <span className="phone-home-row__text">
              <span className="phone-home-row__title">{item.post.titulo}</span>
              <span className="phone-home-row__context">
                {[
                  item.post.cliente_nome,
                  item.post.scheduled_at
                    ? t('minhaFila.publica', { data: formatPostDate(item.post.scheduled_at) })
                    : t('minhaFila.semData', 'sem data de publicação'),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
            {item.prazoDate && (
              <span className={`board-card-deadline phone-home-badge ${prazoClass(item.deadline)}`}>
                {formatEtapaPrazo(item.deadline).label}
              </span>
            )}
          </Link>
        </li>
      ))}
    </PhoneSection>
  );
}
