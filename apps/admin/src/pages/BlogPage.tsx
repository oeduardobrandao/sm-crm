import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import { SegmentedControl } from '@mesaas/ios-kit';
import {
  approveBlogPost,
  getBlogPost,
  listBlogPosts,
  rejectBlogPost,
  republishBlogPost,
  requestBlogChanges,
  retryBlogPublish,
  unpublishBlogPost,
  updateBlogPost,
  type AdminApiError,
} from '../lib/api';
import { blogPath } from '../lib/routes';
import { useIsPhone } from '../hooks/useIsPhone';
import { PageHeader } from '../components/PageHeader';
import { GlassPanel } from '../components/shell/GlassPanel';
import { BlogList } from './blog/BlogList';
import { BlogDetail, type BlogCommand } from './blog/BlogDetail';
import {
  BLOG_TABS,
  formatDay,
  isLive,
  noRecentDraft,
  parseTab,
  sortQueue,
  type BlogPostDetail,
  type BlogTab,
} from './blog/blog-view';

const BLOG_KEY = ['admin', 'blog'] as const;
const listKey = (tab: BlogTab) => [...BLOG_KEY, 'list', tab] as const;
const postKey = (id: string) => [...BLOG_KEY, 'post', id] as const;

/** A publicando row only turns publicado when list-blog-posts confirms it live. */
const PUBLISHING_POLL_MS = 60_000;

const SUCCESS: Record<BlogCommand['kind'], string> = {
  approve: 'Publicação iniciada.',
  request: 'Ajuste pedido.',
  reject: 'Post rejeitado.',
  unpublish: 'Despublicação iniciada.',
  republish: 'Publicação iniciada.',
  retry: 'Publicação disparada de novo.',
  update: 'Texto salvo.',
};

function send(id: string, post: BlogPostDetail, c: BlogCommand) {
  switch (c.kind) {
    case 'approve':
      return approveBlogPost(id, post.revision);
    case 'request':
      return requestBlogChanges(id, c.note, post.revision);
    case 'reject':
      return rejectBlogPost(id, c.reason || undefined);
    case 'unpublish':
      return unpublishBlogPost(id);
    case 'republish':
      return republishBlogPost(id);
    case 'retry':
      return retryBlogPublish(id);
    case 'update':
      return updateBlogPost(id, c.fields, post.revision);
  }
}

export default function BlogPage() {
  const isPhone = useIsPhone();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const tab = parseTab(params.get('tab'));

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const [editing, setEditing] = useState(false);
  const [editorErrors, setEditorErrors] = useState<string[]>([]);
  useEffect(() => {
    setEditing(false);
    setEditorErrors([]);
  }, [id]);

  const list = useQuery({
    queryKey: listKey(tab),
    queryFn: () => listBlogPosts(tab),
    refetchInterval: (q) =>
      q.state.data?.posts.some((r) => r.status === 'publicando') ? PUBLISHING_POLL_MS : false,
  });
  const detail = useQuery({
    queryKey: postKey(id ?? ''),
    queryFn: () => getBlogPost(id!),
    enabled: !!id,
    // A focus refetch mid-edit would swap the post under the form; the save's
    // expected_revision catches a real conflict instead.
    refetchOnWindowFocus: !editing,
  });

  const rows = useMemo(() => sortQueue(list.data?.posts ?? [], now), [list.data, now]);
  const lastDraftAt = list.data?.last_draft_at ?? null;
  const post = detail.data?.post;

  const refresh = () => qc.invalidateQueries({ queryKey: BLOG_KEY });

  const mutation = useMutation({
    // id and post ride in the variables: a toast's "Tentar de novo" may fire after the admin
    // has opened another post.
    mutationFn: (v: { id: string; post: BlogPostDetail; c: BlogCommand }) =>
      send(v.id, v.post, v.c),
  });

  async function run(c: BlogCommand, target = post): Promise<boolean> {
    if (!target) return false;
    setEditorErrors([]);
    try {
      await mutation.mutateAsync({ id: target.id, post: target, c });
    } catch (e) {
      handleError(e as AdminApiError, c, target);
      return false;
    }
    toast.success(
      c.kind === 'update' && isLive(target) ? 'Texto salvo. Publicação iniciada.' : SUCCESS[c.kind],
    );
    if (c.kind === 'update') setEditing(false);
    // Mutations return the list columns only (no body): refetch the post instead of using them.
    await refresh();
    return true;
  }

  function handleError(err: AdminApiError, c: BlogCommand, target: BlogPostDetail) {
    const code = typeof err.body?.error === 'string' ? err.body.error : '';
    if (err.status === 409 || code === 'conflict') {
      toast.error('Este post mudou enquanto você revisava. Carregamos a versão atual.');
      setEditing(false);
      void refresh();
    } else if (code === 'publish_unavailable') {
      toast.error('Publicação indisponível neste ambiente.');
    } else if (code === 'invalid_fields') {
      const details = Array.isArray(err.body?.details)
        ? err.body.details.filter((d): d is string => typeof d === 'string')
        : [];
      setEditorErrors(details.length > 0 ? details : ['Revise os campos e tente de novo.']);
    } else if (code === 'deploy_hook_failed' && err.body?.saved === true) {
      toast.error('Texto salvo, mas a publicação não começou.', {
        action: { label: 'Tentar de novo', onClick: () => void run({ kind: 'retry' }, target) },
      });
      setEditing(false);
      void refresh();
    } else if (code === 'deploy_hook_failed') {
      toast.error('Não foi possível iniciar a publicação. Tente de novo.');
      void refresh();
    } else if (err.status === 404) {
      toast.error('Este post não existe mais.');
      void refresh();
    } else {
      toast.error(
        c.kind === 'update'
          ? 'Não foi possível salvar o texto.'
          : 'Não foi possível concluir a ação.',
      );
    }
  }

  const banner = noRecentDraft(lastDraftAt, now) ? (
    <div
      role="status"
      className="mb-4 flex items-start gap-2 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground"
    >
      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
      <span>
        Nenhum rascunho novo desde {formatDay(lastDraftAt)}. Confira a rotina e o conector.
      </span>
    </div>
  ) : null;

  const tabs = (
    <SegmentedControl
      aria-label="Fila"
      options={BLOG_TABS}
      value={tab}
      onChange={(v) => navigate(blogPath(v))}
      className="inline-flex [&>button]:px-3"
    />
  );

  const listView = (
    <BlogList
      rows={rows}
      tab={tab}
      selectedId={id ?? null}
      now={now}
      isLoading={list.isLoading}
      isError={list.isError}
      onRetry={() => void list.refetch()}
    />
  );

  const detailView = (
    <BlogDetail
      key={id ?? 'none'}
      post={id ? post : undefined}
      isLoading={!!id && detail.isLoading}
      isError={!!id && detail.isError}
      onRetryLoad={() => void detail.refetch()}
      now={now}
      pending={mutation.isPending}
      editing={editing}
      onEditingChange={(e) => {
        setEditing(e);
        setEditorErrors([]);
      }}
      editorErrors={editorErrors}
      run={(c) => run(c)}
    />
  );

  const description = 'Posts escritos pela rotina. Nada vai ao ar sem sua aprovação.';

  if (isPhone) {
    if (id) {
      return (
        <div>
          <PageHeader title="Post" back={{ to: blogPath(tab), label: 'Blog' }} />
          <GlassPanel flush>{detailView}</GlassPanel>
        </div>
      );
    }
    return (
      <div>
        <PageHeader title="Blog" description={description}>
          {tabs}
        </PageHeader>
        {banner}
        <GlassPanel flush>{listView}</GlassPanel>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Blog" description={description}>
        {tabs}
      </PageHeader>
      {banner}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
        <GlassPanel flush>{listView}</GlassPanel>
        <GlassPanel flush>{detailView}</GlassPanel>
      </div>
    </div>
  );
}
