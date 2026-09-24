import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import type { HubPost } from '../../types';
import { isInProduction } from '../../lib/postView';

const PURPLE = '#8b5cf6';

/**
 * Read-only explanation for a post the client already saw that is back with the agency.
 * The "próxima aprovação" wording depends on `tipo` ONLY (never on attached media):
 * arte for feed/carrossel, vídeo for reels, conteúdo for stories.
 */
export function InProductionNotice({ post }: { post: HubPost }) {
  const { t } = useTranslation('hubPosts');
  if (!isInProduction(post)) return null;

  let title: string;
  let body: string;
  if (post.em_producao === 'proxima_aprovacao') {
    title = t('production.nextApprovalTitle', 'Você aprovou o texto.');
    body =
      post.tipo === 'reels'
        ? t(
            'production.nextApprovalBody_video',
            'A equipe está produzindo o vídeo deste post. Ele volta para Aprovações quando estiver pronto para a próxima aprovação.',
          )
        : post.tipo === 'stories'
          ? t(
              'production.nextApprovalBody_conteudo',
              'A equipe está produzindo o conteúdo deste post. Ele volta para Aprovações quando estiver pronto para a próxima aprovação.',
            )
          : t(
              'production.nextApprovalBody_arte',
              'A equipe está produzindo a arte deste post. Ele volta para Aprovações quando estiver pronto para a próxima aprovação.',
            );
  } else if (post.em_producao === 'correcao') {
    title = t('production.correcaoTitle', 'A equipe está fazendo as correções que você pediu.');
    body = t('production.correcaoBody', 'O post volta para Aprovações quando estiver pronto.');
  } else {
    title = t('production.ajusteTitle', 'A equipe está ajustando este post.');
    body = t('production.ajusteBody', 'Ele volta para Aprovações quando estiver pronto.');
  }

  return (
    <div
      role="status"
      className="mb-3 flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-[12.5px] leading-[1.45] hub-txt"
      style={{ background: `${PURPLE}0f`, border: `1px solid ${PURPLE}30` }}
    >
      <Clock size={16} className="shrink-0 mt-px" style={{ color: PURPLE }} aria-hidden="true" />
      <p>
        <span className="font-semibold">{title}</span> {body}
      </p>
    </div>
  );
}
