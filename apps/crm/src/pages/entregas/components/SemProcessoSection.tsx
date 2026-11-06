import { useTranslation } from 'react-i18next';
import { CircleDashed } from 'lucide-react';
import type { ActivePost } from '../../../store';
import { useStatusRegistry } from '@/hooks/useStatusRegistry';
import { TIPO_LABELS } from '../postLabels';
import { PostStatusChip } from './PostStatusChip';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import '../phone/entregasPhone.css';

interface SemProcessoSectionProps {
  /** Já limitados a SEM_PROCESSO_LIMIT pela página. */
  posts: ActivePost[];
  /** Total antes do limite, para o contador. */
  total: number;
  productionFiltersActive: boolean;
  onPostClick: (post: ActivePost) => void;
  onApplyProcess: (post: ActivePost) => void;
  onVerTodos: () => void;
}

/**
 * Seção abaixo das linhas de etapas (spec §4.3): avulsos sem processo vigente.
 * Não posiciona os posts numa coluna pelo status nem inventa prazo ou
 * responsável de etapa. Fase 4: ação Aplicar processo por card.
 */
export function SemProcessoSection({
  posts,
  total,
  productionFiltersActive,
  onPostClick,
  onApplyProcess,
  onVerTodos,
}: SemProcessoSectionProps) {
  const { t } = useTranslation('entregas');
  const registry = useStatusRegistry();
  const isPhone = !useIsDesktop(768);
  if (total === 0) return null;
  if (isPhone) {
    // Celular: lista agrupada no idioma do kit, mesma ação por linha.
    return (
      <section className="phone-ent-sem" aria-labelledby="sem-processo-title">
        <div className="phone-ent-board__head">
          <h2 id="sem-processo-title" className="phone-ent-board__title">
            {t('semProcesso.title')} <span>{total}</span>
          </h2>
          <button type="button" className="phone-ent-text-btn" onClick={onVerTodos}>
            {t('semProcesso.viewAll')}
          </button>
        </div>
        {productionFiltersActive && (
          <p className="phone-ent-board__hint">{t('semProcesso.filtersNote')}</p>
        )}
        <ul className="phone-ent-sem__list">
          {posts.map((post) => (
            <li key={post.id} className="phone-ent-sem__row">
              <button
                type="button"
                className="phone-ent-sem__main"
                onClick={() => onPostClick(post)}
              >
                <span className="phone-ent-sem__title">
                  {post.titulo || t('calendarGrid.untitled')}
                </span>
                <span className="phone-ent-sem__meta">
                  {post.cliente_nome || t('listGroups.noCliente')} · {TIPO_LABELS[post.tipo]} ·{' '}
                  {t('calendarGrid.avulso')}
                </span>
                <PostStatusChip post={post} registry={registry} />
              </button>
              <button
                type="button"
                className="phone-ent-text-btn"
                aria-label={t('semProcesso.applyTo', {
                  title: post.titulo || t('calendarGrid.untitled'),
                })}
                onClick={() => onApplyProcess(post)}
              >
                {t('semProcesso.apply')}
              </button>
            </li>
          ))}
        </ul>
      </section>
    );
  }
  return (
    <section className="sem-processo animate-up" aria-labelledby="sem-processo-title">
      <div className="sem-processo-head">
        <h2 id="sem-processo-title" className="sem-processo-title">
          {t('semProcesso.title')}
        </h2>
        <span className="board-column-count">{total}</span>
        <button type="button" className="sem-processo-link" onClick={onVerTodos}>
          {t('semProcesso.viewAllPublicacoes')}
        </button>
      </div>
      {productionFiltersActive && (
        <p className="sem-processo-note">{t('semProcesso.filtersNote')}</p>
      )}
      <div className="sem-processo-grid">
        {posts.map((post) => (
          <div
            key={post.id}
            className="scheduled-item board-post-card sem-processo-card"
            role="button"
            tabIndex={0}
            onClick={() => onPostClick(post)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onPostClick(post);
            }}
          >
            <div className="item-top">
              <span className="board-post-tipo">{TIPO_LABELS[post.tipo]}</span>
              <PostStatusChip post={post} registry={registry} />
            </div>
            <div className="item-title">{post.titulo || t('calendarGrid.untitled')}</div>
            <span className="post-fluxo-tag post-fluxo-tag--avulso">
              <CircleDashed size={11} aria-hidden="true" style={{ flexShrink: 0 }} />
              {t('calendarGrid.avulso')}
            </span>
            <div className="item-meta" style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
              {post.cliente_nome || '—'}
            </div>
            <button
              type="button"
              className="sem-processo-link"
              aria-label={t('semProcesso.apply')}
              onClick={(e) => {
                e.stopPropagation();
                onApplyProcess(post);
              }}
              onKeyDown={(e) => e.stopPropagation()}
            >
              {t('semProcesso.apply')}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
