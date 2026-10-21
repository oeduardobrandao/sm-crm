import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { affiliateSendLink } from '@/services/affiliates';

/** Cartão para pedir um novo link de acesso por e-mail (link vencido, sessão ausente). */
export default function RequestLinkCard({ title, body }: { title: string; body: string }) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await affiliateSendLink(email);
      setSentTo(email.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível concluir. Tente de novo.');
    } finally {
      setLoading(false);
    }
  };

  if (sentTo) {
    return (
      <div
        className="mx-auto mt-10 max-w-md rounded-xl border border-border bg-card p-8 text-center"
        role="status"
      >
        <CircleCheck className="mx-auto mb-4 h-10 w-10 text-[var(--success)]" aria-hidden="true" />
        <h1 className="mb-2 text-xl font-semibold">Confira seu e-mail</h1>
        <p className="text-sm text-muted-foreground">
          Se {sentTo} for de um afiliado, o link de acesso chega em instantes. Ele vale por 15
          minutos e funciona uma vez.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-10 max-w-md rounded-xl border border-border bg-card p-8">
      <CircleAlert className="mb-4 h-8 w-8 text-[var(--warning)]" aria-hidden="true" />
      <h1 className="mb-2 text-xl font-semibold">{title}</h1>
      <p className="mb-6 text-sm text-muted-foreground">{body}</p>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="af-link-email">E-mail</Label>
          <Input
            id="af-link-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="voce@exemplo.com"
          />
        </div>
        {error && (
          <p className="text-sm text-[var(--danger-text)]" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? 'Enviando…' : 'Enviar link de acesso'}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-muted-foreground">
        Ainda não é afiliado?{' '}
        <Link to="/afiliados" className="underline underline-offset-2 hover:text-foreground">
          Conheça o programa
        </Link>
      </p>
    </div>
  );
}
