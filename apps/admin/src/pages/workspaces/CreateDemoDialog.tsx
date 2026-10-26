import { useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { createDemoWorkspace, type Plan } from '../../lib/api';
import { workspaceDetailPath } from '../../lib/routes';
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

/** Mirror of the CRM's INTERNAL_PLAN_IDS: plans that are never sold. */
const INTERNAL_PLAN_IDS = new Set(['lifetime']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function demoPlans(plans: Plan[]): Plan[] {
  return plans.filter((p) => p.is_active && !p.is_default && !INTERNAL_PLAN_IDS.has(p.id));
}

const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 md:text-sm';

interface CreateDemoDialogProps {
  plans: Plan[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateDemoDialog({ plans, open, onOpenChange }: CreateDemoDialogProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [planId, setPlanId] = useState('');
  const [nome, setNome] = useState('');
  const [empresa, setEmpresa] = useState('');
  const [refCode, setRefCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  // React Query flips isPending a tick late: a fast double click would otherwise create twice.
  const inFlight = useRef(false);

  const options = demoPlans(plans);
  const trimmedEmail = email.trim();
  const valid = EMAIL_RE.test(trimmedEmail) && planId !== '';

  const mutation = useMutation({
    mutationFn: () =>
      createDemoWorkspace({
        email: trimmedEmail,
        plan_id: planId,
        ...(nome.trim() ? { nome: nome.trim() } : {}),
        ...(empresa.trim() ? { empresa: empresa.trim() } : {}),
        ...(refCode.trim() ? { ref_code: refCode.trim() } : {}),
      }),
    onSettled: () => {
      inFlight.current = false;
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'workspaces'] });
      if (res.email_sent) {
        toast.success(`Conta demo criada. O acesso foi enviado para ${res.email}.`);
      } else {
        toast.message('Conta criada, mas o e-mail não foi enviado. Use Reenviar acesso.');
      }
      onOpenChange(false);
      navigate(workspaceDetailPath(res.workspace_id));
    },
    onError: (err: Error) => setError(err.message || 'Não foi possível criar a conta demo.'),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid || mutation.isPending || inFlight.current) return;
    inFlight.current = true;
    setError(null);
    mutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (mutation.isPending ? undefined : onOpenChange(o))}>
      <DialogContent>
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>Criar conta demo</DialogTitle>
            <DialogDescription>
              Cria o workspace com dados de exemplo e envia o link para o dono definir a senha.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="demo-email">E-mail</Label>
              <Input
                id="demo-email"
                type="email"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="demo-nome">Nome (opcional)</Label>
              <Input id="demo-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="demo-empresa">Nome da agência (opcional)</Label>
              <Input
                id="demo-empresa"
                value={empresa}
                onChange={(e) => setEmpresa(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="demo-plano">Plano</Label>
              <select
                id="demo-plano"
                className={SELECT_CLASS}
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
              >
                <option value="">Selecione um plano</option>
                {options.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="demo-ref">Código de afiliado (opcional)</Label>
              <Input
                id="demo-ref"
                autoComplete="off"
                value={refCode}
                onChange={(e) => setRefCode(e.target.value)}
              />
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
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
              disabled={!valid || mutation.isPending}
              aria-busy={mutation.isPending || undefined}
            >
              Criar e enviar acesso
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
