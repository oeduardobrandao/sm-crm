import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import { setWorkspaceAffiliate } from '../../lib/api';
import { affiliateDetailPath } from '../../lib/routes';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';

interface AffiliateRowProps {
  workspaceId: string;
  affiliate: { id: string; name: string; code: string } | null | undefined;
}

/** "Afiliado" row of the workspace detail: current affiliate (name + code, linked) and an editor. */
export function AffiliateRow({ workspaceId, affiliate }: AffiliateRowProps) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (refCode: string | null) => setWorkspaceAffiliate(workspaceId, refCode),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'workspace', workspaceId] });
      toast.success(res.affiliate ? 'Afiliado atualizado' : 'Afiliado removido');
      setEditing(false);
    },
    onError: (err: Error) => setError(err.message || 'Não foi possível salvar o afiliado.'),
  });

  useUnsavedWork(editing && (code.trim() !== (affiliate?.code ?? '') || mutation.isPending));

  function startEdit() {
    setCode(affiliate?.code ?? '');
    setError(null);
    setEditing(true);
  }

  function save() {
    const next = code.trim();
    setError(null);
    mutation.mutate(next === '' ? null : next);
  }

  return (
    <div className="flex flex-col gap-2 px-[18px] py-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground">Afiliado</span>
        <span className="flex min-w-0 items-center gap-2">
          {affiliate ? (
            <Link
              to={affiliateDetailPath(affiliate.id)}
              className="min-w-0 truncate font-medium text-primary hover:underline"
            >
              {affiliate.name}
              <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                {affiliate.code}
              </span>
            </Link>
          ) : (
            <span className="text-dim-foreground">Sem afiliado</span>
          )}
          {!editing && (
            <Button variant="secondary" size="sm" onClick={startEdit}>
              Editar afiliado
            </Button>
          )}
        </span>
      </div>
      {editing && (
        <div className="flex flex-col gap-2">
          <Label htmlFor={`aff-code-${workspaceId}`} className="sr-only">
            Código de afiliado
          </Label>
          <Input
            id={`aff-code-${workspaceId}`}
            placeholder="Código de afiliado"
            autoComplete="off"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={save} disabled={mutation.isPending}>
              Salvar
            </Button>
            {affiliate && (
              <Button
                size="sm"
                variant="destructive"
                disabled={mutation.isPending}
                onClick={() => {
                  setError(null);
                  mutation.mutate(null);
                }}
              >
                Remover afiliado
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              disabled={mutation.isPending}
              onClick={() => setEditing(false)}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
