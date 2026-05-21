import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Save, Trash2, Plus, X, Upload, Loader2 } from 'lucide-react';
import {
  getKbArticle, createKbArticle, updateKbArticle, deleteKbArticle,
  listKbContextLinks, upsertKbContextLink, deleteKbContextLink,
  type KbArticle, type KbContextLink,
} from '../lib/api';
import { uploadInlineImage, extractR2Keys, resolveInlineImageUrls, injectSignedUrls } from '../lib/inline-image';
import { ArticleEditor } from '../components/editor/ArticleEditor';

const CATEGORIES: Record<string, string> = {
  'primeiros-passos': 'Getting Started',
  'clientes': 'Clients',
  'equipe': 'Team',
  'entregas-e-fluxos': 'Deliveries & Flows',
  'hub-do-cliente': 'Client Hub',
  'instagram-e-analytics': 'Instagram & Analytics',
  'post-express': 'Post Express',
  'financeiro': 'Financial',
  'arquivos': 'Files',
};

const ALL_CATEGORIES = Object.keys(CATEGORIES);

const CRM_ROUTES = [
  { value: '/dashboard', label: 'Dashboard' },
  { value: '/clientes', label: 'Clientes' },
  { value: '/equipe', label: 'Equipe' },
  { value: '/entregas', label: 'Entregas' },
  { value: '/post-express', label: 'Post Express' },
  { value: '/analytics', label: 'Analytics' },
  { value: '/analytics-fluxos', label: 'Analytics de Fluxos' },
  { value: '/financeiro', label: 'Financeiro' },
  { value: '/contratos', label: 'Contratos' },
  { value: '/configuracao', label: 'Configuração' },
  { value: '/calendario', label: 'Calendário' },
  { value: '/leads', label: 'Leads' },
  { value: '/ideias', label: 'Ideias' },
  { value: '/arquivos', label: 'Arquivos' },
];

const RESERVED_SLUGS = ['novo', 'editar'];

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
  const isEdit = !!id;

  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [category, setCategory] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [tags, setTags] = useState('');
  const [displayOrder, setDisplayOrder] = useState('0');
  const [status, setStatus] = useState<'draft' | 'published'>('draft');
  const [coverUrl, setCoverUrl] = useState('');
  const [coverPreview, setCoverPreview] = useState('');
  const [coverUploading, setCoverUploading] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<{ json: Record<string, unknown> | null; plain: string }>({ json: null, plain: '' });
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

    if (article.content) {
      const r2Keys = extractR2Keys(article.content);
      if (r2Keys.length > 0) {
        setContentLoading(true);
        resolveInlineImageUrls(r2Keys)
          .then(urlMap => setResolvedContent(injectSignedUrls(article.content!, urlMap)))
          .finally(() => setContentLoading(false));
      } else {
        setResolvedContent(article.content);
      }
    }
  }, [article]);

  const isR2Key = (val: string) => val && !val.startsWith('http');

  useEffect(() => {
    if (!coverUrl) { setCoverPreview(''); return; }
    if (!isR2Key(coverUrl)) { setCoverPreview(coverUrl); return; }
    resolveInlineImageUrls([coverUrl]).then(urls => {
      setCoverPreview(urls[coverUrl] || '');
    });
  }, [coverUrl]);

  const handleCoverUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('File must be an image');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Image must be under 10 MB');
      return;
    }
    setCoverUploading(true);
    try {
      const result = await uploadInlineImage(file);
      setCoverUrl(result.r2Key);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setCoverUploading(false);
    }
  };

  useEffect(() => {
    if (!isEdit && title) {
      setSlug(slugify(title));
    }
  }, [title, isEdit]);

  const handleEditorUpdate = useCallback(
    (json: Record<string, unknown>, plain: string) => {
      contentRef.current = { json, plain };
    },
    [],
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'kb-articles'] });
    qc.invalidateQueries({ queryKey: ['admin', 'kb-article', id] });
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const parsedTags = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];
      const payload = {
        title,
        slug,
        category,
        excerpt: excerpt || null,
        tags: parsedTags,
        display_order: Math.max(0, parseInt(displayOrder, 10) || 0),
        status,
        content: contentRef.current.json,
        content_plain: contentRef.current.plain,
        cover_image_url: coverUrl || null,
      };

      if (isEdit && article) {
        return updateKbArticle({ article_id: article.id, ...payload });
      }
      return createKbArticle(payload);
    },
    onSuccess: (data) => {
      invalidate();
      toast.success(isEdit ? 'Article updated' : 'Article created');
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
      toast.success('Article deleted');
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
      toast.success('Context link added');
    } catch {
      toast.error('Failed to add context link');
    }
  };

  const removeContextLink = async (linkId: string) => {
    try {
      await deleteKbContextLink(linkId);
      refetchLinks();
      toast.success('Context link removed');
    } catch {
      toast.error('Failed to remove context link');
    }
  };

  const usedRoutes = new Set(contextLinks.map(l => l.route_pattern));

  const slugError = slug && (
    RESERVED_SLUGS.includes(slug) ? 'Reserved slug' :
    !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) ? 'Only lowercase letters, numbers, hyphens' :
    null
  );

  if (isEdit && articleLoading) {
    return <p className="text-sm text-dim-foreground py-8">Loading...</p>;
  }

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/admin/kb-articles')} className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft size={18} />
          </button>
          <h1 className="font-['Playfair_Display'] text-xl font-bold">
            {isEdit ? 'Edit Article' : 'New Article'}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {isEdit && (
            <button
              onClick={() => { if (confirm('Delete this article permanently?')) deleteMut.mutate(); }}
              disabled={deleteMut.isPending}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-destructive/30 text-sm text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
            >
              <Trash2 size={14} /> Delete
            </button>
          )}
          <button
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending || !title || !slug || !category || !!slugError}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary-hover transition-colors disabled:opacity-50"
          >
            <Save size={14} /> {saveMut.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Form fields */}
      <div className="bg-card border border-border rounded-2xl p-5 md:p-6 space-y-5 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="How to add a client"
              className="w-full px-3 py-2 rounded-lg bg-secondary border border-transparent text-sm text-foreground placeholder-dim-foreground focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Slug *</label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="how-to-add-a-client"
              className={`w-full px-3 py-2 rounded-lg bg-secondary border text-sm font-['DM_Mono'] text-foreground placeholder-dim-foreground focus:outline-none focus:border-primary ${slugError ? 'border-destructive' : 'border-transparent'}`}
            />
            {slugError && <p className="text-xs text-destructive mt-1">{slugError}</p>}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Category *</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-secondary border border-transparent text-sm text-foreground focus:outline-none focus:border-primary"
            >
              <option value="">Select category</option>
              {ALL_CATEGORIES.map((c) => (
                <option key={c} value={c}>{CATEGORIES[c]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Tags</label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="instagram, tutorial, basics"
              className="w-full px-3 py-2 rounded-lg bg-secondary border border-transparent text-sm text-foreground placeholder-dim-foreground focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Excerpt</label>
          <textarea
            value={excerpt}
            onChange={(e) => setExcerpt(e.target.value)}
            placeholder="Brief article description (max 200 chars)"
            rows={2}
            maxLength={200}
            className="w-full px-3 py-2 rounded-lg bg-secondary border border-transparent text-sm text-foreground placeholder-dim-foreground focus:outline-none focus:border-primary resize-none"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Cover Image</label>
          <div className="flex items-start gap-3">
            <div className="flex-1 flex items-center gap-2">
              <input
                type="text"
                value={coverUrl}
                onChange={(e) => setCoverUrl(e.target.value)}
                placeholder="https://... or upload an image"
                className="flex-1 px-3 py-2 rounded-lg bg-secondary border border-transparent text-sm font-['DM_Mono'] text-foreground placeholder-dim-foreground focus:outline-none focus:border-primary"
              />
              <input
                ref={coverInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleCoverUpload(file);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => coverInputRef.current?.click()}
                disabled={coverUploading}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:border-primary transition-colors disabled:opacity-50 shrink-0"
              >
                {coverUploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {coverUploading ? 'Uploading...' : 'Upload'}
              </button>
              {coverUrl && (
                <button
                  type="button"
                  onClick={() => setCoverUrl('')}
                  className="p-2 rounded-lg text-muted-foreground hover:text-destructive transition-colors shrink-0"
                  title="Remove cover"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
          {coverPreview && (
            <div className="mt-2 rounded-xl overflow-hidden border border-border">
              <img src={coverPreview} alt="Cover preview" className="w-full max-h-48 object-cover" />
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Display Order</label>
            <input
              type="number"
              value={displayOrder}
              onChange={(e) => setDisplayOrder(e.target.value)}
              min={0}
              className="w-full px-3 py-2 rounded-lg bg-secondary border border-transparent text-sm font-['DM_Mono'] text-foreground focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as 'draft' | 'published')}
              className="w-full px-3 py-2 rounded-lg bg-secondary border border-transparent text-sm text-foreground focus:outline-none focus:border-primary"
            >
              <option value="draft">Draft</option>
              <option value="published">Published</option>
            </select>
          </div>
        </div>
      </div>

      {/* Content editor */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden mb-6">
        <div className="px-5 pt-4 pb-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Content</label>
        </div>
        {contentLoading ? (
          <p className="text-sm text-dim-foreground py-8 px-5">Loading content...</p>
        ) : (
          <ArticleEditor
            initialContent={isEdit ? resolvedContent : null}
            onUpdate={handleEditorUpdate}
            onUploadInlineImage={uploadInlineImage}
          />
        )}
      </div>

      {/* Context links — only in edit mode */}
      {isEdit && article && (
        <div className="bg-card border border-border rounded-2xl p-5 md:p-6">
          <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Context Links</label>
          <p className="text-xs text-dim-foreground mb-3">Select which CRM pages show this article as a help suggestion.</p>

          {contextLinks.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {contextLinks.map(link => {
                const route = CRM_ROUTES.find(r => r.value === link.route_pattern);
                return (
                  <span
                    key={link.id}
                    className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-xs text-foreground"
                  >
                    {route?.label ?? link.route_pattern}
                    <button
                      type="button"
                      className="rounded-full p-0.5 hover:bg-border transition-colors"
                      onClick={() => removeContextLink(link.id)}
                    >
                      <X size={12} />
                    </button>
                  </span>
                );
              })}
            </div>
          )}

          <div className="flex items-center gap-2">
            <select
              value={selectedRoute}
              onChange={(e) => setSelectedRoute(e.target.value)}
              className="px-3 py-2 rounded-lg bg-secondary border border-transparent text-sm text-foreground focus:outline-none focus:border-primary"
            >
              <option value="">Select page</option>
              {CRM_ROUTES.filter(r => !usedRoutes.has(r.value)).map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={addContextLink}
              disabled={!selectedRoute}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:border-primary transition-colors disabled:opacity-50"
            >
              <Plus size={14} /> Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
