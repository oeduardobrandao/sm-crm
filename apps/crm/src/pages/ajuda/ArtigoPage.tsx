import { useEffect, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import UnderlineExt from '@tiptap/extension-underline';
import LinkExt from '@tiptap/extension-link';
import Color from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import Youtube from '@tiptap/extension-youtube';
import { ArrowLeft, Clock } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { getArticleBySlug, getPublishedArticles } from '@/store/kb';
import { extractR2Keys, resolveInlineImageUrls, injectSignedUrls } from '@/services/inlineImage';
import { CalloutExtension } from '../entregas/components/CalloutExtension';
import { createInlineImageExtension } from '../entregas/components/InlineImageExtension';
import { IframeExtension } from './components/IframeExtension';
import { TableOfContents } from './components/TableOfContents';
import { CATEGORY_LABELS, ALL_CATEGORIES } from './categoryConfig';
import { ArticleCard } from './components/ArticleCard';

function readingTime(plainText: string): number {
  return Math.max(1, Math.ceil(plainText.trim().split(/\s+/).length / 200));
}

const dummyUpload = async () => ({ r2Key: '', src: '', width: 0, height: 0 });

export default function ArtigoPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();

  const { data: article, isLoading } = useQuery({
    queryKey: ['kb-article', slug],
    queryFn: () => getArticleBySlug(slug!),
    enabled: !!slug,
  });

  const { data: allArticles = [] } = useQuery({
    queryKey: ['kb-articles'],
    queryFn: getPublishedArticles,
  });

  const relatedArticles = useMemo(
    () =>
      allArticles
        .filter((a) => a.category === article?.category && a.id !== article?.id)
        .slice(0, 3),
    [allArticles, article],
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      UnderlineExt,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      LinkExt.configure({ openOnClick: true }),
      CalloutExtension,
      Youtube.configure({ inline: false }),
      IframeExtension,
      createInlineImageExtension(dummyUpload),
    ],
    editable: false,
    content: undefined,
  });

  useEffect(() => {
    if (!editor || !article?.content) return;
    let cancelled = false;

    (async () => {
      const r2Keys = extractR2Keys(article.content);
      let contentToSet = article.content;
      if (r2Keys.length > 0) {
        const urlMap = await resolveInlineImageUrls(r2Keys);
        contentToSet = injectSignedUrls(article.content!, urlMap);
      }
      if (!cancelled) {
        editor.commands.setContent(contentToSet as Record<string, unknown>);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [editor, article]);

  // Add IDs to rendered headings for TOC anchor navigation
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      try {
        const editorEl = editor.view.dom;
        editorEl.querySelectorAll('h2, h3').forEach((h) => {
          const text = h.textContent ?? '';
          h.id = text
            .toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^\w-]/g, '');
        });
      } catch {
        /* editor not mounted yet */
      }
    };
    editor.on('update', update);
    update();
    return () => {
      editor.off('update', update);
    };
  }, [editor, article]);

  const rawCover = article?.cover_image_url ?? null;
  const coverIsR2 = !!rawCover && !rawCover.startsWith('http');
  const { data: resolvedCover } = useQuery({
    queryKey: ['cover-url', rawCover],
    queryFn: () => resolveInlineImageUrls([rawCover!]).then((m) => m[rawCover!] ?? ''),
    enabled: coverIsR2,
    staleTime: 10 * 60 * 1000,
  });
  const coverSrc = coverIsR2 ? resolvedCover || null : rawCover;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!article) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <p className="text-[var(--text-light)]">Artigo não encontrado.</p>
        <Link to="/ajuda">
          <Button variant="outline" size="sm">
            Voltar
          </Button>
        </Link>
      </div>
    );
  }

  const minutes = readingTime(article.content_plain);
  const categoryLabel = CATEGORY_LABELS[article.category] ?? article.category;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6 flex items-center gap-1.5 text-[0.82rem] text-[var(--text-light)]">
        <Link
          to="/ajuda"
          className="inline-flex items-center gap-1.5 hover:text-[var(--text-main)] transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Central de Ajuda
        </Link>
        {ALL_CATEGORIES.includes(article.category) && (
          <>
            <span>/</span>
            <Link
              to={`/ajuda/secao/${encodeURIComponent(article.category)}`}
              className="hover:text-[var(--text-main)] transition-colors"
            >
              {CATEGORY_LABELS[article.category] ?? article.category}
            </Link>
          </>
        )}
      </div>

      {coverSrc && (
        <div className="mb-6 overflow-hidden rounded-2xl">
          <img src={coverSrc} alt={article.title} className="w-full max-h-80 object-cover" />
        </div>
      )}

      <div className="mb-6">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="inline-block rounded-sm px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider bg-[rgba(234,179,8,0.1)] text-[var(--primary-color)]">
            {categoryLabel}
          </span>
          <span className="flex items-center gap-1 text-[0.72rem] text-[var(--text-light)]">
            <Clock className="h-3 w-3" />
            {minutes} min de leitura
          </span>
          <span className="text-[0.72rem] text-[var(--text-light)]">
            {new Date(article.created_at).toLocaleDateString('pt-BR')}
          </span>
        </div>
        <h1 className="font-[var(--font-heading)] text-[clamp(1.8rem,3.5vw,2.6rem)] font-black tracking-tight text-[var(--text-main)]">
          {article.title}
        </h1>
      </div>

      <div className="flex gap-8">
        <article className="min-w-0 flex-1">
          <EditorContent
            editor={editor}
            className="post-editor-content article-reader-content prose-article"
          />
        </article>
        <TableOfContents content={article.content} />
      </div>

      {relatedArticles.length > 0 && (
        <div className="mt-12 border-t border-[var(--border-color)] pt-8">
          <h2 className="mb-4 text-[1.1rem] font-bold text-[var(--text-main)]">
            Artigos relacionados
          </h2>
          <div
            className="grid gap-5"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
          >
            {relatedArticles.map((a) => (
              <ArticleCard key={a.id} article={a} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
