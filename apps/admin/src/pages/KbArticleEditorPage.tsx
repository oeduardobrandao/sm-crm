import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  getKbArticle,
  createKbArticle,
  updateKbArticle,
  deleteKbArticle,
  listKbContextLinks,
  upsertKbContextLink,
  deleteKbContextLink,
} from '../lib/api';
import {
  uploadInlineImage,
  extractR2Keys,
  resolveInlineImageUrls,
  injectSignedUrls,
} from '../lib/inline-image';
import { useIsPhone } from '../hooks/useIsPhone';
import { ArticleEditor } from '../components/editor/ArticleEditor';
import { KbArticleEditorDesktop } from './kb-articles/KbArticleEditorDesktop';
import { KbArticleEditorPhone } from './kb-articles/KbArticleEditorPhone';
import {
  CRM_ROUTES,
  STATUS_LABELS,
  type ArticleStatus,
  type KbArticleEditorViewProps,
} from './kb-articles/editor-view';

const RESERVED_SLUGS = ['novo', 'editar', 'video'];

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export default function KbArticleEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isPhone = useIsPhone();
  const isEdit = !!id;

  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [category, setCategory] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [tags, setTags] = useState('');
  const [displayOrder, setDisplayOrder] = useState('0');
  const [status, setStatus] = useState<ArticleStatus>('draft');
  const [coverUrl, setCoverUrl] = useState('');
  const [coverPreview, setCoverPreview] = useState('');
  const [coverUploading, setCoverUploading] = useState(false);
  const contentRef = useRef<{ json: Record<string, unknown> | null; plain: string }>({
    json: null,
    plain: '',
  });
  // Crossing 768px swaps the phone and desktop views, which remounts the TipTap editor with
  // `initialContent`. Left alone that is the loaded document, so the remount would drop (and undo
  // would revert past) whatever was typed. So the flip render itself, by comparing against the
  // isPhone it last saw, picks the latest typed document as the seed: the new editor mounts with
  // it as its initial content. Reloading the article (load or post-save refetch) clears the seed.
  const editedRef = useRef(false);
  const seedRef = useRef<{ isPhone: boolean; seed: Record<string, unknown> | null }>({
    isPhone,
    seed: null,
  });
  if (seedRef.current.isPhone !== isPhone) {
    seedRef.current = {
      isPhone,
      seed: editedRef.current ? contentRef.current.json : seedRef.current.seed,
    };
  }
  const remountSeed = seedRef.current.seed;

  const [resolvedContent, setResolvedContent] = useState<Record<string, unknown> | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [selectedRoute, setSelectedRoute] = useState('');

  const { data: articleData, isLoading: articleLoading } = useQuery({
    queryKey: ['admin', 'kb-article', id],
    queryFn: () => getKbArticle(id!),
    enabled: isEdit,
  });

  const article = articleData?.article;

  const { data: linksData, refetch: refetchLinks } = useQuery({
    queryKey: ['admin', 'kb-context-links', id],
    queryFn: () => listKbContextLinks(id!),
    enabled: isEdit,
  });

  const contextLinks = linksData?.links ?? [];

  useEffect(() => {
    if (!article) return;
    setTitle(article.title);
    setSlug(article.slug);
    setCategory(article.category);
    setExcerpt(article.excerpt ?? '');
    setTags(article.tags.join(', '));
    setDisplayOrder(String(article.display_order));
    setStatus(article.status);
    setCoverUrl(article.cover_image_url ?? '');
    contentRef.current = { json: article.content, plain: article.content_plain };
    editedRef.current = false;
    seedRef.current = { ...seedRef.current, seed: null };

    if (article.content) {
      const r2Keys = extractR2Keys(article.content);
      if (r2Keys.length > 0) {
        setContentLoading(true);
        resolveInlineImageUrls(r2Keys)
          .then((urlMap) => setResolvedContent(injectSignedUrls(article.content!, urlMap)))
          .finally(() => setContentLoading(false));
      } else {
        setResolvedContent(article.content);
      }
    }
  }, [article]);

  const isR2Key = (val: string) => val && !val.startsWith('http');

  useEffect(() => {
    if (!coverUrl) {
      setCoverPreview('');
      return;
    }
    if (!isR2Key(coverUrl)) {
      setCoverPreview(coverUrl);
      return;
    }
    resolveInlineImageUrls([coverUrl]).then((urls) => {
      setCoverPreview(urls[coverUrl] || '');
    });
  }, [coverUrl]);

  const handleCoverUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('O arquivo precisa ser uma imagem');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('A imagem precisa ter até 10 MB');
      return;
    }
    setCoverUploading(true);
    try {
      const result = await uploadInlineImage(file);
      setCoverUrl(result.r2Key);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha no upload');
    } finally {
      setCoverUploading(false);
    }
  };

  useEffect(() => {
    if (!isEdit && title) {
      setSlug(slugify(title));
    }
  }, [title, isEdit]);

  const handleEditorUpdate = useCallback((json: Record<string, unknown>, plain: string) => {
    editedRef.current = true;
    contentRef.current = { json, plain };
  }, []);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'kb-articles'] });
    qc.invalidateQueries({ queryKey: ['admin', 'kb-article', id] });
  };

  // `override` lets "Publicar" save with the new status in the same click (setStatus would only
  // land on the next render).
  const saveMut = useMutation({
    mutationFn: async (override?: { status: ArticleStatus }) => {
      const parsedTags = tags
        ? tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
        : [];
      const payload = {
        title,
        slug,
        category,
        excerpt: excerpt || null,
        tags: parsedTags,
        display_order: Math.max(0, parseInt(displayOrder, 10) || 0),
        status: override?.status ?? status,
        content: contentRef.current.json,
        content_plain: contentRef.current.plain,
        cover_image_url: coverUrl || null,
      };

      if (isEdit && article) {
        return updateKbArticle({ article_id: article.id, ...payload });
      }
      return createKbArticle(payload);
    },
    onSuccess: (data, override) => {
      if (override) setStatus(override.status);
      invalidate();
      toast.success(isEdit ? 'Artigo atualizado' : 'Artigo criado');
      if (!isEdit && data.article) {
        navigate(`/admin/kb-articles/${data.article.id}/edit`, { replace: true });
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteKbArticle(article!.id),
    onSuccess: () => {
      invalidate();
      toast.success('Artigo excluído');
      navigate('/admin/kb-articles', { replace: true });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const addContextLink = async () => {
    if (!selectedRoute || !article) return;
    try {
      await upsertKbContextLink({ route_pattern: selectedRoute, article_id: article.id });
      setSelectedRoute('');
      refetchLinks();
      toast.success('Link de contexto adicionado');
    } catch {
      toast.error('Falha ao adicionar link de contexto');
    }
  };

  const removeContextLink = async (linkId: string) => {
    try {
      await deleteKbContextLink(linkId);
      refetchLinks();
      toast.success('Link de contexto removido');
    } catch {
      toast.error('Falha ao remover link de contexto');
    }
  };

  const usedRoutes = new Set(contextLinks.map((l) => l.route_pattern));

  const slugError =
    slug &&
    (RESERVED_SLUGS.includes(slug)
      ? 'Slug reservado'
      : !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)
        ? 'Apenas letras minúsculas, números e hifens'
        : null);

  if (isEdit && articleLoading) {
    return <p className="py-8 text-sm text-dim-foreground">Carregando…</p>;
  }

  const editorContent = remountSeed ?? (isEdit ? resolvedContent : null);
  const editor = contentLoading ? (
    <p className="px-5 py-8 text-sm text-dim-foreground">Carregando…</p>
  ) : (
    <ArticleEditor
      initialContent={editorContent}
      onUpdate={handleEditorUpdate}
      onUploadInlineImage={uploadInlineImage}
    />
  );

  let saveState: string;
  if (saveMut.isPending) saveState = 'Salvando…';
  else if (article) {
    const saved = new Date(article.updated_at);
    const when = Number.isNaN(saved.getTime())
      ? 'Salvo'
      : `Salvo ${formatDistanceToNow(saved, { addSuffix: true, locale: ptBR })}`;
    saveState = `${when} · ${STATUS_LABELS[article.status]}`;
  } else saveState = 'Ainda não salvo';

  const view: KbArticleEditorViewProps = {
    isEdit,
    saveState,
    values: { title, slug, category, excerpt, tags, displayOrder, status, coverUrl },
    set: {
      title: setTitle,
      slug: setSlug,
      category: setCategory,
      excerpt: setExcerpt,
      tags: setTags,
      displayOrder: setDisplayOrder,
      status: setStatus,
      coverUrl: setCoverUrl,
    },
    slugError: slugError || null,
    coverPreview,
    coverUploading,
    onCoverFile: handleCoverUpload,
    editor,
    contextEnabled: isEdit && !!article,
    contextLinks,
    availableRoutes: CRM_ROUTES.filter((r) => !usedRoutes.has(r.value)),
    selectedRoute,
    onSelectedRouteChange: setSelectedRoute,
    onAddContextLink: addContextLink,
    onRemoveContextLink: removeContextLink,
    canSave: !!title && !!slug && !!category && !slugError,
    saving: saveMut.isPending,
    onSave: () => saveMut.mutate(undefined),
    onPublish: () => saveMut.mutate({ status: 'published' }),
    onDelete: isEdit
      ? () => {
          if (confirm('Excluir este artigo permanentemente?')) deleteMut.mutate();
        }
      : undefined,
    deleting: deleteMut.isPending,
  };

  return isPhone ? <KbArticleEditorPhone {...view} /> : <KbArticleEditorDesktop {...view} />;
}
