import { CircleDashed } from 'lucide-react';
import type { ActivePost } from '../../../store';
import { useStatusRegistry } from '@/hooks/useStatusRegistry';
import { TIPO_LABELS } from '../postLabels';
import { PostStatusChip } from './PostStatusChip';

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
  const registry = useStatusRegistry();
  if (total === 0) return null;
  return (
    <section className="sem-processo animate-up" aria-labelledby="sem-processo-title">
      <div className="sem-processo-head">
        <h2 id="sem-processo-title" className="sem-processo-title">
          Sem processo
        </h2>
        <span className="board-column-count">{total}</span>
        <button type="button" className="sem-processo-link" onClick={onVerTodos}>
          Ver todos em Publicações
        </button>
      </div>
      {productionFiltersActive && (
        <p className="sem-processo-note">
          Filtros de produção não se aplicam aos posts sem processo
        </p>
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
            <div className="item-title">{post.titulo || 'Post sem título'}</div>
            <span className="post-fluxo-tag post-fluxo-tag--avulso">
              <CircleDashed size={11} aria-hidden="true" style={{ flexShrink: 0 }} />
              Avulso
            </span>
            <div className="item-meta" style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
              {post.cliente_nome || '—'}
            </div>
            <button
              type="button"
              className="sem-processo-link"
              aria-label="Aplicar processo"
              onClick={(e) => {
                e.stopPropagation();
                onApplyProcess(post);
              }}
            >
              Aplicar processo
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
