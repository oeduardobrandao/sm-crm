import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { extendReverseTrial } from '../../lib/api';
import {
  MAX_TRIAL_DAYS,
  extendDateBounds,
  extendEndsAt,
  formatDay,
  formatSpDate,
  spDate,
} from '../../lib/reverse-trial';
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

interface ExtendTrialDialogProps {
  workspaceId: string;
  startedAt: string;
  endsAt: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Picks a new end date (São Paulo day) for a workspace in the teste sem cartão. */
export function ExtendTrialDialog({
  workspaceId,
  startedAt,
  endsAt,
  open,
  onOpenChange,
}: ExtendTrialDialogProps) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(spDate(endsAt));
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const bounds = extendDateBounds(startedAt, new Date());

  useEffect(() => {
    if (!open) return;
    setDate(spDate(endsAt));
    setError(null);
  }, [open, endsAt]);

  const valid = date !== '' && date >= bounds.min && date <= bounds.max;

  const mutation = useMutation({
    mutationFn: () => extendReverseTrial(workspaceId, extendEndsAt(date, endsAt)),
    onSettled: () => {
      inFlight.current = false;
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'workspace', workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'workspaces'] });
      toast.success(`Teste estendido até ${formatSpDate(res.ends_at)}`);
      onOpenChange(false);
    },
    onError: (err: Error) => setError(err.message || 'Não foi possível estender o teste.'),
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
            <DialogTitle>Estender teste sem cartão</DialogTitle>
            <DialogDescription>
              O teste termina em {formatSpDate(endsAt)}. Ele pode durar até {MAX_TRIAL_DAYS} dias
              desde o início, ou seja, até {formatDay(bounds.max)}.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="extend-trial-date">Nova data de término</Label>
              <Input
                id="extend-trial-date"
                type="date"
                min={bounds.min}
                max={bounds.max}
                value={date}
                onChange={(e) => setDate(e.target.value)}
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
              Estender
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
