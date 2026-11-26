import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import {
  DELETE_WORKSPACE_CONFIRM_WORD,
  deleteWorkspace,
  previewDeleteWorkspace,
  type DeleteWorkspacePreview,
  type DeleteWorkspaceResult,
} from '../../lib/api';
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
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Skeleton } from '../../components/ui/skeleton';

interface DeleteWorkspaceDialogProps {
  workspaceId: string;
  workspaceName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function plural(n: number, one: string, many: string) {
  return `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`;
}

/** What the success toast says: the workspace, plus any login that did not go as planned. */
export function deleteResultMessage(res: DeleteWorkspaceResult): string {
  const parts = [`Workspace "${res.workspace_name}" excluído.`];
  if (res.logins_deleted > 0)
    parts.push(plural(res.logins_deleted, 'login excluído.', 'logins excluídos.'));
  if (res.logins_kept.length > 0) {
    parts.push(`Mantido (entrou em outro workspace): ${res.logins_kept.join(', ')}.`);
  }
  if (res.logins_failed.length > 0) {
    parts.push(`Não foi possível excluir o login de ${res.logins_failed.join(', ')}.`);
  }
  return parts.join(' ');
}

function memberLabel(m: DeleteWorkspacePreview['members'][number]) {
  return m.email ?? m.name ?? m.user_id;
}

/**
 * Permanent delete of a whole workspace. The preview (counts, logins that go with it, billing
 * blocker) loads when the dialog opens; the button only arms once the admin types the exact
 * confirmation word, which the server checks again.
 */
export function DeleteWorkspaceDialog({
  workspaceId,
  workspaceName,
  open,
  onOpenChange,
}: DeleteWorkspaceDialogProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const previewQuery = useQuery({
    queryKey: ['admin', 'workspace', workspaceId, 'delete-preview'],
    queryFn: () => previewDeleteWorkspace(workspaceId),
    enabled: open,
    staleTime: 0,
    gcTime: 0,
  });

  useEffect(() => {
    if (!open) return;
    setTyped('');
    setError(null);
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => deleteWorkspace(workspaceId, typed.trim()),
    onSettled: () => {
      inFlight.current = false;
    },
    onSuccess: (res) => {
      queryClient.removeQueries({ queryKey: ['admin', 'workspace', workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'workspaces'] });
      const message = deleteResultMessage(res);
      if (res.logins_failed.length > 0) toast.warning(message);
      else toast.success(message);
      onOpenChange(false);
      navigate('/admin/workspaces', { replace: true });
    },
    onError: (err: Error) => {
      setError(err.message || 'Não foi possível excluir o workspace.');
      // A subscription may have appeared since the preview: show the current blocker.
      void previewQuery.refetch();
    },
  });

  const preview = previewQuery.data;
  const blocker = preview?.blocker ?? null;
  const armed = typed.trim() === DELETE_WORKSPACE_CONFIRM_WORD;
  const canDelete = !!preview && !blocker && armed && !mutation.isPending;
  const losing = preview?.members.filter((m) => m.login_deleted) ?? [];
  const keeping = preview?.members.filter((m) => !m.login_deleted) ?? [];

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canDelete || inFlight.current) return;
    inFlight.current = true;
    setError(null);
    mutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (mutation.isPending ? undefined : onOpenChange(o))}>
      <DialogContent>
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>Excluir workspace</DialogTitle>
            <DialogDescription>
              Exclui <strong className="text-foreground">{workspaceName}</strong> e tudo o que há
              nele. Não dá para desfazer.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <div
              role="note"
              className="flex gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm"
            >
              <AlertTriangle
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-destructive"
              />
              <div className="flex flex-col gap-1">
                <p className="m-0 font-semibold">Exclusão permanente, sem backup.</p>
                <p className="m-0 text-muted-foreground">
                  Clientes, posts, tarefas, financeiro, contratos, relatórios, integrações e o Hub
                  dos clientes somem na hora, e os links do Hub param de funcionar. Arquivos e
                  mídias saem do armazenamento pela limpeza automática.
                </p>
              </div>
            </div>

            {previewQuery.isLoading ? (
              <div className="flex flex-col gap-2" aria-label="Carregando o que será excluído">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ) : previewQuery.isError ? (
              <p role="alert" className="m-0 text-sm text-destructive">
                Não foi possível carregar o que será excluído.{' '}
                <button
                  type="button"
                  className="border-0 bg-transparent p-0 font-semibold text-foreground underline"
                  onClick={() => void previewQuery.refetch()}
                >
                  Tentar de novo
                </button>
              </p>
            ) : preview ? (
              <>
                <ul className="m-0 grid grid-cols-2 gap-2 p-0 text-sm" aria-label="Será excluído">
                  {[
                    plural(preview.counts.clientes, 'cliente', 'clientes'),
                    plural(preview.counts.posts, 'post', 'posts'),
                    plural(preview.counts.arquivos, 'arquivo', 'arquivos'),
                    plural(preview.counts.membros, 'membro', 'membros'),
                  ].map((item) => (
                    <li
                      key={item}
                      className="list-none rounded-lg bg-foreground/[0.06] px-3 py-2 font-medium"
                    >
                      {item}
                    </li>
                  ))}
                </ul>
                {losing.length > 0 ? (
                  <div className="text-sm">
                    <p className="m-0 font-semibold">
                      {losing.length === 1 ? 'Login excluído junto' : 'Logins excluídos junto'}
                    </p>
                    <p className="m-0 text-muted-foreground">
                      Não têm nada em outro workspace: {losing.map(memberLabel).join(', ')}.
                    </p>
                  </div>
                ) : null}
                {keeping.length > 0 ? (
                  <div className="text-sm">
                    <p className="m-0 font-semibold">Mantêm o login</p>
                    <p className="m-0 text-muted-foreground">
                      Participam ou têm dados em outro workspace, ou são admins da plataforma:{' '}
                      {keeping.map(memberLabel).join(', ')}.
                    </p>
                  </div>
                ) : null}
                {blocker ? (
                  <p
                    role="alert"
                    className="m-0 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm font-medium"
                  >
                    {blocker.message}
                  </p>
                ) : null}
              </>
            ) : null}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="delete-workspace-confirm">
                Para confirmar, digite{' '}
                <code className="rounded bg-foreground/[0.08] px-1 py-0.5 font-mono text-[13px]">
                  {DELETE_WORKSPACE_CONFIRM_WORD}
                </code>
              </Label>
              <Input
                id="delete-workspace-confirm"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                disabled={!!blocker || mutation.isPending}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                aria-describedby={error ? 'delete-workspace-error' : undefined}
              />
            </div>
            {error ? (
              <p id="delete-workspace-error" role="alert" className="m-0 text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={mutation.isPending}
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={!canDelete}
              aria-busy={mutation.isPending || undefined}
              className="bg-destructive text-destructive-foreground shadow hover:bg-destructive/90"
            >
              {mutation.isPending ? 'Excluindo…' : 'Excluir workspace'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
