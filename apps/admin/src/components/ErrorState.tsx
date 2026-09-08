import { AlertTriangle } from 'lucide-react';
import { Button } from './ui/button';

interface ErrorStateProps {
  /** Generic, user-safe text. Never pass a raw error message here. */
  message?: string;
  onRetry: () => void;
}

export function ErrorState({ message = 'Não foi possível carregar.', onRetry }: ErrorStateProps) {
  return (
    <div role="alert" className="flex flex-col items-center px-5 py-10 text-center">
      <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
        <AlertTriangle size={18} />
      </span>
      <p className="text-sm text-foreground">{message}</p>
      <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
        Tentar novamente
      </Button>
    </div>
  );
}
