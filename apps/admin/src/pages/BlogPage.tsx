import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import { SegmentedControl } from '@mesaas/ios-kit';
import {
  approveBlogPost,
  getBlogMetrics,
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
import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { BlogList } from './blog/BlogList';
import { FilePostDetail } from './blog/FilePostDetail';
import { BlogDetail, type BlogCommand, type RunResult } from './blog/BlogDetail';
import {
  BLOG_SORTS,
  BLOG_TABS,
  formatDay,
  isLive,
  itemsFor,
  noRecentDraft,
  parseSort,
  parseTab,
  sortItems,
  withSort,
  type BlogPostDetail,
  type BlogTab,
} from './blog/blog-view';

const BLOG_KEY = ['admin', 'blog'] as const;
const listKey = (tab: BlogTab) => [...BLOG_KEY, 'list', tab] as const;
const metricsKey = [...BLOG_KEY, 'metrics'] as const;
const postKey = (id: string) => [...BLOG_KEY, 'post', id] as const;

/** A publicando row only turns publicado when list-blog-posts confirms it live. */
const PUBLISHING_POLL_MS = 60_000;

/** blog-metrics is a daily snapshot plus a counter: five minutes stale is fine. */
const METRICS_STALE_MS = 5 * 60_000;

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
      return requestBlogChanges(id, c.note, c.revision);
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
  const { id, slug } = useParams<{ id: string; slug: string }>();
  const [params, setParams] = useSearchParams();
  // A hand-written post only exists on Publicados, whatever the query string says.
  const tab = slug ? 'publicados' : parseTab(params.get('tab'));

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const [editing, setEditing] = useState(false);
  const [editorErrors, setEditorErrors] = useState<string[]>([]);
  // The post as it was when the editor opened: saves diff against it and send its revision.
  const [editBase, setEditBase] = useState<BlogPostDetail | undefined>();
  const [editorConflict, setEditorConflict] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const [pendingNav, setPendingNav] = useState<string | null>(null);
  // Bumped by Recarregar so the editor always remounts on the fresh base.
  const [editorReloads, setEditorReloads] = useState(0);
  const stopEditing = useCallback(() => {
    setEditing(false);
    setEditBase(undefined);
    setEditorErrors([]);
    setEditorConflict(false);
    setEditorDirty(false);
  }, []);
  useEffect(() => stopEditing(), [id, stopEditing]);

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
    refetchOnReconnect: !editing,
  });

  // Live rows only exist on Publicados (and Aguardando while publicando); Rejeitados has none.
  const metricsQuery = useQuery({
    queryKey: metricsKey,
    queryFn: getBlogMetrics,
    enabled: tab !== 'rejeitados',
    staleTime: METRICS_STALE_MS,
  });
  const metrics = metricsQuery.data;
  const gscReady = metrics?.gsc_updated_at != null;
  // Mais cliques needs Search Console data; a stale ?ordem=cliques falls back to recentes.
  const parsedSort = parseSort(params.get('ordem'));
  const sort =
    tab !== 'publicados' || (parsedSort === 'cliques' && !gscReady) ? 'recentes' : parsedSort;

  const items = useMemo(
    () =>
      sortItems(
        itemsFor(tab, list.data?.posts ?? [], list.data?.file_posts ?? [], now),
        metrics?.posts ?? {},
        sort,
      ),
    [tab, list.data, now, metrics, sort],
  );
  const filePost = slug ? list.data?.file_posts?.find((f) => f.slug === slug) : undefined;
  const lastDraftAt = list.data?.last_draft_at ?? null;
  const post = detail.data?.post;

  const refresh = () => qc.invalidateQueries({ queryKey: BLOG_KEY });

  // The list is what confirms a go-live (and polls while publishing): when it shows the open
  // post with another status or revision, the detail is stale.
  const listed = id ? list.data?.posts.find((r) => r.id === id) : undefined;
  const listedStatus = listed?.status;
  const listedRevision = listed?.revision;
  useEffect(() => {
    // While editing, the editor's base must not move; its save's revision check catches changes.
    if (!id || !post || editing || listedStatus === undefined) return;
    if (listedStatus !== post.status || listedRevision !== post.revision) {
      void qc.invalidateQueries({ queryKey: postKey(id) });
    }
  }, [id, post, editing, listedStatus, listedRevision, qc]);

  const mutation = useMutation({
    // id and post ride in the variables: a toast's "Tentar de novo" may fire after the admin
    // has opened another post.
    mutationFn: (v: { id: string; post: BlogPostDetail; c: BlogCommand }) =>
      send(v.id, v.post, v.c),
  });

  // One action at a time: a double click or the toast's "Tentar de novo" while another call
  // is in flight sends nothing (mutation.isPending lags a render behind a fast second click).
  const inFlight = useRef(false);

  async function run(c: BlogCommand, explicitTarget?: BlogPostDetail): Promise<RunResult> {
    // A save goes against the version the editor opened with, never the live detail: a
    // refetch mid-edit must turn into a 409, not a silent overwrite of newer text.
    const target = explicitTarget ?? (c.kind === 'update' ? (editBase ?? post) : post);
    if (!target) return 'failed';
    if (inFlight.current) {
      toast.error('Aguarde a ação em andamento terminar.');
      return 'busy';
    }
    inFlight.current = true;
    setEditorErrors([]);
    try {
      await mutation.mutateAsync({ id: target.id, post: target, c });
    } catch (e) {
      handleError(e as AdminApiError, c, target);
      return 'failed';
    } finally {
      inFlight.current = false;
    }
    toast.success(
      c.kind === 'update' && isLive(target)
        ? 'Texto salvo. Publicação iniciada.'
        : c.kind === 'retry' && target.status === 'despublicado'
          ? 'Despublicação disparada de novo.'
          : SUCCESS[c.kind],
    );
    if (c.kind === 'update') stopEditing();
    // Mutations return the list columns only (no body): refetch the post instead of using them.
    await refresh();
    return 'ok';
  }

  function handleError(err: AdminApiError, c: BlogCommand, target: BlogPostDetail) {
    const code = typeof err.body?.error === 'string' ? err.body.error : '';
    if ((err.status === 409 || code === 'conflict') && c.kind === 'update') {
      // Never rebase or drop the draft: the editor says so and offers Recarregar.
      setEditorConflict(true);
    } else if (err.status === 409 || code === 'conflict') {
      toast.error('Este post mudou enquanto você revisava. Carregamos a versão atual.');
      void refresh();
    } else if (code === 'publish_unavailable') {
      toast.error('Publicação indisponível neste ambiente.');
    } else if (code === 'invalid_fields') {
      const details = Array.isArray(err.body?.details)
        ? err.body.details.filter((d): d is string => typeof d === 'string')
        : [];
      if (c.kind === 'update') {
        setEditorErrors(details.length > 0 ? details : ['Revise os campos e tente de novo.']);
      } else {
        // Approve, republish and retry re-validate the whole row: the editor is closed, so the
        // problems go in a toast. Editar texto fixes them.
        toast.error('O post tem campos inválidos. Corrija em Editar texto.', {
          description: details.slice(0, 3).join(' '),
        });
      }
    } else if (code === 'deploy_hook_failed' && err.body?.saved === true) {
      toast.error('Texto salvo, mas a publicação não começou.', {
        action: { label: 'Tentar de novo', onClick: () => void run({ kind: 'retry' }, target) },
      });
      stopEditing();
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
      onChange={(v) => go(blogPath(v))}
      className="inline-flex [&>button]:px-3"
    />
  );

  // Leaving a changed draft (another row, a tab) asks first.
  const guard = editing && editorDirty;
  function go(to: string) {
    if (guard) setPendingNav(to);
    else navigate(to);
  }

  const reloadEditor = async () => {
    const r = await detail.refetch();
    if (!r.data) return;
    setEditBase(r.data.post);
    setEditorReloads((n) => n + 1);
    setEditorConflict(false);
    setEditorErrors([]);
  };

  const discardDialog = (
    <Dialog open={pendingNav !== null} onOpenChange={(o) => !o && setPendingNav(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Descartar alterações?</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            O texto que você editou neste post ainda não foi salvo.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setPendingNav(null)}>
            Continuar editando
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              const to = pendingNav;
              setPendingNav(null);
              stopEditing();
              if (to) navigate(to);
            }}
          >
            Descartar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  const sortControl =
    tab === 'publicados' ? (
      <div className="border-b border-border/60 px-[18px] py-3">
        <SegmentedControl
          aria-label="Ordem"
          options={BLOG_SORTS.filter((o) => o.value !== 'cliques' || gscReady)}
          value={sort}
          onChange={(v) =>
            setParams(
              (prev) => {
                const next = new URLSearchParams(prev);
                if (v === 'recentes') next.delete('ordem');
                else next.set('ordem', v);
                return next;
              },
              { replace: true },
            )
          }
          className="blog-sort flex w-full [&>button]:min-w-0 [&>button]:flex-1 [&>button]:overflow-hidden [&>button]:text-ellipsis [&>button]:whitespace-nowrap [&>button]:px-2"
        />
      </div>
    ) : null;

  const listView = (
    <>
      {sortControl}
      <BlogList
        items={items}
        tab={tab}
        selectedKey={slug ? `arquivo:${slug}` : (id ?? null)}
        now={now}
        isLoading={list.isLoading}
        isError={list.isError}
        onRetry={() => void list.refetch()}
        onOpen={guard ? go : undefined}
        metrics={metrics}
        sort={sort}
      />
    </>
  );

  const detailView = filePost ? (
    <FilePostDetail post={filePost} metrics={metrics} />
  ) : (
    <BlogDetail
      key={id ?? slug ?? 'none'}
      post={id ? post : undefined}
      // A file post is read from the list: loading and "not found" are the list's.
      isLoading={(!!id && detail.isLoading) || (!!slug && list.isLoading)}
      isError={(!!id && detail.isError) || (!!slug && !list.isLoading)}
      onRetryLoad={() => void (slug ? list.refetch() : detail.refetch())}
      now={now}
      pending={mutation.isPending}
      editing={editing}
      onEditingChange={(e) => {
        if (!e) return stopEditing();
        setEditBase(post);
        setEditorErrors([]);
        setEditorConflict(false);
        setEditing(true);
      }}
      editorErrors={editorErrors}
      editBase={editBase}
      editorReloads={editorReloads}
      editorConflict={editorConflict}
      onReloadEditor={() => void reloadEditor()}
      onEditorDirtyChange={setEditorDirty}
      run={(c) => run(c)}
      metrics={metrics}
    />
  );

  const description = 'Posts escritos pela rotina. Nada vai ao ar sem sua aprovação.';

  if (isPhone) {
    if (id || slug) {
      return (
        <div>
          <PageHeader
            title="Post"
            back={{
              to: withSort(blogPath(tab), sort),
              label: 'Blog',
              // Only while a changed draft is open; otherwise the nav bar's own back.
              onClick: guard ? () => go(withSort(blogPath(tab), sort)) : undefined,
            }}
          />
          <GlassPanel flush>{detailView}</GlassPanel>
          {discardDialog}
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
      {discardDialog}
    </div>
  );
}
