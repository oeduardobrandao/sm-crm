// Route entry (docs/estudio-design.md §6.1): /estudio (picker) + /estudio/:postId (editor).
// The editor canvas itself (Canvas/Toolbar/Dock — T2.4 onward) doesn't exist yet; this PR wires
// the picker, the entry flows, and the get-or-create query end to end, with a minimal read-only
// summary standing in for the canvas until it lands.
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PostPicker from './components/PostPicker';
import { usePostDesignQuery, PostDesignError } from './hooks/usePostDesignQuery';
import { useDesignDocState } from './hooks/useDesignDocState';

function EstudioEditorStub({ postId }: { postId: number }) {
  const { t } = useTranslation('estudio');
  const query = usePostDesignQuery(postId);
  const state = useDesignDocState(
    query.data?.design ?? {
      version: 1,
      format: 'feed',
      aspect_ratio: '1:1',
      canvas: { width: 1080, height: 1080 },
      pages: [],
      fileIds: [],
    },
  );

  useEffect(() => {
    if (query.data) state.load(query.data.design);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data]);

  if (query.isLoading) {
    return (
      <div className="page-full-bleed flex items-center justify-center">
        <p style={{ color: 'var(--text-muted)' }}>{t('editor.loading')}</p>
      </div>
    );
  }

  if (query.isError) {
    const err = query.error;
    const message =
      err instanceof PostDesignError && err.code === 'post_not_found'
        ? t('editor.notFound')
        : t('editor.loadError');
    return (
      <div className="page-full-bleed flex items-center justify-center">
        <p style={{ color: 'var(--danger)' }}>{message}</p>
      </div>
    );
  }

  const layerCount = state.doc.pages.reduce((n, p) => n + p.layers.length, 0);

  return (
    <div className="page-full-bleed" style={{ padding: 'clamp(1.25rem, 3vw, 2.5rem)' }}>
      <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.8rem', fontWeight: 900 }}>
        {t('title')}
      </h1>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.5rem' }}>
        {t('editor.pageCount', { count: state.doc.pages.length })} ·{' '}
        {t('editor.layerCount', { count: layerCount })}
      </p>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '1rem' }}>
        {t('editor.canvasComingSoon')}
      </p>
    </div>
  );
}

export default function EstudioPage() {
  const { postId: postIdParam } = useParams<{ postId?: string }>();

  if (!postIdParam) return <PostPicker />;

  const postId = parseInt(postIdParam, 10);
  if (isNaN(postId)) return <PostPicker />;

  return <EstudioEditorStub postId={postId} />;
}
