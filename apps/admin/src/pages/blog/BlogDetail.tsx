import { useEffect, useId, useState, type ReactNode } from 'react';
import { Check, ExternalLink, Maximize2, Newspaper, X } from 'lucide-react';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Label } from '../../components/ui/label';
import { Skeleton } from '../../components/ui/skeleton';
import { Textarea } from '../../components/ui/textarea';
import { cn } from '../../lib/utils';
import { BlogEditor } from './BlogEditor';
import { BlogPreview } from './BlogPreview';
import {
  NOTE_MAX,
  STATUS_LABEL,
  actionsFor,
  checkLines,
  chipsFor,
  failingChecks,
  formatDateTime,
  isSlowPublish,
  showsRetry,
  type BlogPostDetail,
  type EditableField,
} from './blog-view';

const LIVE_BASE = 'https://www.mesaas.com.br/blog/';

export type BlogCommand =
  | { kind: 'approve' }
  | { kind: 'request'; note: string; revision: number }
  | { kind: 'reject'; reason: string }
  | { kind: 'unpublish' }
  | { kind: 'republish' }
  | { kind: 'retry' }
  | { kind: 'update'; fields: Partial<Record<EditableField, string>> };

/** ok / failed: the action ran. busy: another action was still in flight, nothing was sent. */
export type RunResult = 'ok' | 'failed' | 'busy';

export interface BlogDetailProps {
  post: BlogPostDetail | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetryLoad: () => void;
  now: Date;
  pending: boolean;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  editorErrors: string[];
  /** The post as it was when the editor opened (see BlogEditor). */
  editBase: BlogPostDetail | undefined;
  /** Recarregar count, part of the editor's key. */
  editorReloads: number;
  editorConflict: boolean;
  onReloadEditor: () => void;
  onEditorDirtyChange: (dirty: boolean) => void;
  /** Runs one action (the caller toasts and refetches). */
  run: (command: BlogCommand) => Promise<RunResult>;
}

type ConfirmKind = 'approve' | 'reject' | 'unpublish' | 'republish';

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  pending,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  pending: boolean;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {description}
          </DialogDescription>
        </DialogHeader>
        {children ? <DialogBody className="pb-4">{children}</DialogBody> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={pending}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SideSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-border px-[18px] py-4 first:border-t-0">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function BlogDetail(p: BlogDetailProps) {
  const uid = useId();
  const [note, setNote] = useState('');
  // The revision on screen when the admin started the note: the request is about that text.
  const [noteRevision, setNoteRevision] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState<ConfirmKind | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  useUnsavedWork(note.trim() !== '');
  // A confirm is about the revision the admin read. If the post changes under an open dialog
  // (a 409 refetch, the publishing poll), close it rather than re-bind it to unread text.
  const revision = p.post?.revision;
  const status = p.post?.status;
  useEffect(() => setConfirm(null), [revision, status]);

  if (p.isLoading) {
    return (
      <div className="flex flex-col gap-3 px-[18px] py-6" aria-label="Carregando o post">
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    );
  }
  if (p.isError) {
    return <ErrorState message="Não foi possível carregar o post." onRetry={p.onRetryLoad} />;
  }
  if (!p.post) {
    return (
      <EmptyState
        icon={Newspaper}
        title="Selecione um post"
        description="A prévia, os checks e as ações aparecem aqui."
      />
    );
  }

  const post = p.post;
  const actions = actionsFor(post);
  const failing = failingChecks(post);
  const lines = checkLines(post);
  // Failing checks have their own list below and publishing its own banner above: the
  // sidebar chips keep only the context (sources, weekly feature, rewrite, stale).
  const chips = chipsFor(post, p.now).filter(
    (c) => c.tone !== 'danger' && c.label !== 'Publicando…' && c.label !== 'Publicação demorando',
  );
  const slow = isSlowPublish(post, p.now);
  const canRequest = actions.includes('request');
  // Constant origin + encoded slug: nothing user-controlled reaches the scheme or host.
  const liveHref = `${LIVE_BASE}${encodeURIComponent(post.slug)}`;

  const confirmAndClose = async (command: Parameters<BlogDetailProps['run']>[0]) => {
    // Closed on failure too: after a conflict the dialog must not confirm the reloaded post.
    if ((await p.run(command)) === 'busy') return;
    setConfirm(null);
    setReason('');
  };

  if (p.editing) {
    return (
      <div className="px-[18px] py-4">
        <BlogEditor
          // Recarregar swaps the base; remount so the form starts from it.
          key={`${(p.editBase ?? post).revision}-${(p.editBase ?? post).status}-${p.editorReloads}`}
          post={p.editBase ?? post}
          saving={p.pending}
          errors={p.editorErrors}
          onSave={(fields) => void p.run({ kind: 'update', fields })}
          onCancel={() => p.onEditingChange(false)}
          conflict={p.editorConflict}
          onReload={p.onReloadEditor}
          onDirtyChange={p.onEditorDirtyChange}
        />
      </div>
    );
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-[18px] py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="neutral" size="sm">
              {STATUS_LABEL[post.status]}
            </Badge>
            <span className="text-xs text-muted-foreground">
              Criado em {formatDateTime(post.created_at)} · revisão {post.revision}
            </span>
          </div>
          <h2 className="mt-1 font-sf text-[17px] font-bold leading-snug">{post.title}</h2>
          <p className="text-xs text-muted-foreground">/blog/{post.slug}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions.includes('reject') && (
            <Button variant="destructive" onClick={() => setConfirm('reject')} disabled={p.pending}>
              Rejeitar
            </Button>
          )}
          {actions.includes('edit') && (
            <Button variant="outline" onClick={() => p.onEditingChange(true)} disabled={p.pending}>
              Editar texto
            </Button>
          )}
          {showsRetry(post, p.now) && (
            <Button
              variant="outline"
              onClick={() => void p.run({ kind: 'retry' })}
              disabled={p.pending}
            >
              Tentar de novo
            </Button>
          )}
          {actions.includes('unpublish') && (
            <Button
              variant="destructive"
              onClick={() => setConfirm('unpublish')}
              disabled={p.pending}
            >
              Despublicar
            </Button>
          )}
          {actions.includes('republish') && (
            <Button onClick={() => setConfirm('republish')} disabled={p.pending}>
              Publicar de novo
            </Button>
          )}
          {actions.includes('approve') && (
            <Button onClick={() => setConfirm('approve')} disabled={p.pending}>
              Aprovar e publicar
            </Button>
          )}
        </div>
      </div>

      {post.status === 'publicando' && (
        <p
          className={cn(
            'border-b border-border px-[18px] py-2.5 text-sm',
            slow ? 'bg-warning/10 text-foreground' : 'text-muted-foreground',
          )}
        >
          {slow
            ? 'Publicação demorando: verifique o deploy na Vercel e tente de novo.'
            : 'Publicando. O status muda quando a versão nova estiver no ar.'}
        </p>
      )}

      <div className="flex flex-col xl:grid xl:grid-cols-[minmax(0,1fr)_300px]">
        {/* Sidebar first on narrow screens: checks and the note matter more than the preview. */}
        <aside
          aria-label="Revisão"
          className="border-b border-border xl:order-2 xl:border-b-0 xl:border-l"
        >
          {chips.length > 0 && (
            <div className="flex flex-wrap gap-1 px-[18px] py-4">
              {chips.map((c) => (
                <Badge key={c.label} variant={c.tone} size="sm">
                  {c.label}
                </Badge>
              ))}
            </div>
          )}
          <SideSection title="Checks">
            {lines ? (
              <ul className="flex flex-col gap-2 text-sm">
                {lines.map((l) => (
                  <li key={l.label}>
                    <span className="flex items-center gap-2">
                      {l.ok ? (
                        <Check size={14} className="shrink-0 text-success" aria-hidden="true" />
                      ) : (
                        <X size={14} className="shrink-0 text-destructive" aria-hidden="true" />
                      )}
                      <span className={cn(!l.ok && 'font-semibold text-destructive')}>
                        {l.label}
                      </span>
                    </span>
                    {l.details.length > 0 && (
                      <ul className="ml-6 mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
                        {l.details.map((d) => (
                          <li key={d} className="break-all">
                            {d}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Checks ainda não rodaram.</p>
            )}
          </SideSection>

          {post.topic_reason && (
            <SideSection title="Por que este tema">
              <p className="whitespace-pre-line text-sm">{post.topic_reason}</p>
            </SideSection>
          )}

          {post.revision_note && (
            <SideSection title="Sua última nota">
              <p className="whitespace-pre-line text-sm">{post.revision_note}</p>
            </SideSection>
          )}

          {post.rejection_reason && (
            <SideSection title="Motivo da rejeição">
              <p className="whitespace-pre-line text-sm">{post.rejection_reason}</p>
            </SideSection>
          )}

          {canRequest && (
            <SideSection title="Pedir ajuste">
              <Label htmlFor={`${uid}-note`} className="sr-only">
                Nota para a rotina
              </Label>
              <Textarea
                id={`${uid}-note`}
                value={note}
                maxLength={NOTE_MAX}
                rows={4}
                placeholder="O que a rotina deve mudar na próxima versão"
                onChange={(e) => {
                  const next = e.target.value;
                  if (next.trim() === '') setNoteRevision(null);
                  else if (noteRevision === null) setNoteRevision(post.revision);
                  setNote(next);
                }}
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-xs tabular-nums text-muted-foreground">
                  {note.length}/{NOTE_MAX}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={note.trim() === '' || p.pending}
                  onClick={async () => {
                    const result = await p.run({
                      kind: 'request',
                      note: note.trim(),
                      revision: noteRevision ?? post.revision,
                    });
                    if (result === 'ok') {
                      setNote('');
                      setNoteRevision(null);
                    } else if (result === 'failed') {
                      // The note stays; the next send is about the version now on screen.
                      setNoteRevision(null);
                    }
                  }}
                >
                  Pedir ajuste
                </Button>
              </div>
            </SideSection>
          )}

          {post.status === 'publicado' && (
            <SideSection title="No ar">
              <a
                href={liveHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                Abrir no site
                <ExternalLink size={13} aria-hidden="true" />
              </a>
            </SideSection>
          )}
        </aside>

        <div className="min-w-0 xl:order-1">
          <div className="flex justify-end px-[18px] pt-3">
            <Button variant="ghost" size="sm" onClick={() => setFullscreen(true)}>
              <Maximize2 aria-hidden="true" />
              Tela cheia
            </Button>
          </div>
          <BlogPreview post={post} />
        </div>
      </div>

      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogContent className="h-[92vh] max-h-[92vh] max-w-[min(1100px,calc(100%-2rem))]">
          <DialogHeader>
            <DialogTitle>Prévia</DialogTitle>
            <DialogDescription className="sr-only">Prévia do post em tela cheia</DialogDescription>
          </DialogHeader>
          <DialogBody className="px-0 py-0">
            <BlogPreview post={post} />
          </DialogBody>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirm === 'approve'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Publicar este post?"
        description="Ele vai ao ar no próximo deploy do site, em alguns minutos."
        confirmLabel="Publicar"
        pending={p.pending}
        onConfirm={() => void confirmAndClose({ kind: 'approve' })}
      >
        {failing.length > 0 ? (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3">
            <p className="text-sm font-semibold text-destructive">Checks com problema</p>
            <ul className="mt-1.5 list-disc pl-5 text-sm">
              {failing.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Todos os checks passaram.</p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm === 'reject'}
        onOpenChange={(o) => {
          if (!o) {
            setConfirm(null);
            setReason('');
          }
        }}
        title="Rejeitar este post?"
        description="O rascunho sai da fila e vai para Rejeitados."
        confirmLabel="Rejeitar"
        destructive
        pending={p.pending}
        onConfirm={() => void confirmAndClose({ kind: 'reject', reason: reason.trim() })}
      >
        <Label htmlFor={`${uid}-reason`} className="mb-1.5 block">
          Motivo (opcional)
        </Label>
        <Textarea
          id={`${uid}-reason`}
          value={reason}
          maxLength={NOTE_MAX}
          rows={3}
          onChange={(e) => setReason(e.target.value)}
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm === 'unpublish'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Despublicar este post?"
        description="A página sai do ar no próximo deploy e o endereço passa a dar 404. Você pode publicar de novo depois."
        confirmLabel="Despublicar"
        destructive
        pending={p.pending}
        onConfirm={() => void confirmAndClose({ kind: 'unpublish' })}
      />

      <ConfirmDialog
        open={confirm === 'republish'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Publicar este post de novo?"
        description="Ele volta ao ar no próximo deploy do site, no mesmo endereço."
        confirmLabel="Publicar"
        pending={p.pending}
        onConfirm={() => void confirmAndClose({ kind: 'republish' })}
      />
    </div>
  );
}
