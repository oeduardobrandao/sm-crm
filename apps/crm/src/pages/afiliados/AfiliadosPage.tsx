import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, CircleCheck, Link2, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { affiliateSendLink, affiliateSignup } from '@/services/affiliates';
import CommissionSimulator from './CommissionSimulator';

const STEPS = [
  {
    icon: Link2,
    title: 'Cadastre-se e pegue seu link',
    body: 'O cadastro é gratuito e não precisa de conta no Mesaas. O link do seu painel chega por e-mail.',
  },
  {
    icon: CalendarClock,
    title: 'Divulgue para quem trabalha com social media',
    body: 'Quem se cadastrar pelo seu link em até 60 dias fica ligado a você.',
  },
  {
    icon: Wallet,
    title: 'Receba 20% de cada pagamento',
    body: 'Você ganha 20% de tudo que o indicado pagar com cartão, todo mês, enquanto a assinatura durar.',
  },
];

const RULES = [
  'Comissão de 20% sobre cada pagamento de assinatura feito com cartão (Stripe), no plano mensal ou anual à vista.',
  'Assinaturas pagas no parcelado em 12x não geram comissão.',
  'O período de teste grátis não gera comissão: ela começa no primeiro pagamento.',
  'Cada comissão fica disponível 30 dias depois do pagamento. Pagamentos estornados ou contestados não geram comissão.',
  'A indicação vale para cadastros feitos em até 60 dias depois do clique no seu link. Vale o último link clicado.',
  'Não vale indicar a si mesmo. O Mesaas pode suspender afiliados em caso de fraude ou divulgação enganosa.',
  'Os repasses são feitos por PIX para a chave cadastrada no seu painel.',
];

export default function AfiliadosPage() {
  const [mode, setMode] = useState<'signup' | 'link'>('signup');
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [telefone, setTelefone] = useState('');
  const [aceite, setAceite] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === 'signup' && !aceite) {
      setError('Para participar, aceite as regras do programa.');
      return;
    }
    setLoading(true);
    try {
      if (mode === 'signup') {
        await affiliateSignup({
          nome,
          email,
          telefone: telefone || undefined,
          aceite_termos: true,
        });
      } else {
        await affiliateSendLink(email);
      }
      setSentTo(email.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível concluir. Tente de novo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-5">
        <Link to="/" aria-label="Mesaas">
          <img src="/logo-black.svg" alt="Mesaas" className="h-5 w-auto dark:hidden" />
          <img src="/logo-white.svg" alt="Mesaas" className="hidden h-5 w-auto dark:block" />
        </Link>
        <a
          href="#cadastro"
          className="text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          Quero participar
        </a>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-16">
        <section className="py-10 text-center md:py-16">
          <p className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Programa de afiliados
          </p>
          <h1 className="mx-auto mb-4 max-w-2xl text-3xl font-bold leading-tight md:text-4xl">
            Indique o Mesaas e ganhe 20% de cada pagamento
          </h1>
          <p className="mx-auto max-w-xl text-base text-muted-foreground">
            Recomende o CRM para outros social medias e agências e receba comissão recorrente
            enquanto eles forem assinantes.
          </p>
        </section>

        <section className="mb-12 grid gap-4 md:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-xl border border-border bg-card p-5">
              <Icon className="mb-3 h-6 w-6 text-[var(--primary-color)]" aria-hidden="true" />
              <h2 className="mb-1 text-base font-semibold">{title}</h2>
              <p className="text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </section>

        <section className="mb-12 grid gap-6 md:grid-cols-2" id="cadastro">
          <CommissionSimulator />

          <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
            {sentTo ? (
              <div className="py-6 text-center" role="status">
                <CircleCheck className="mx-auto mb-4 h-10 w-10 text-[var(--success)]" />
                <h2 className="mb-2 text-lg font-semibold">Confira seu e-mail</h2>
                <p className="text-sm text-muted-foreground">
                  Se {sentTo} estiver cadastrado no programa, o link do seu painel chega em alguns
                  minutos. Olhe também a caixa de spam.
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-4"
                  onClick={() => {
                    setSentTo(null);
                    setMode('link');
                  }}
                >
                  Não recebi, enviar de novo
                </Button>
              </div>
            ) : (
              <form onSubmit={submit} noValidate>
                <h2 className="mb-1 text-lg font-semibold">
                  {mode === 'signup' ? 'Quero ser afiliado' : 'Receber link de acesso'}
                </h2>
                <p className="mb-5 text-sm text-muted-foreground">
                  {mode === 'signup'
                    ? 'Grátis e sem precisar de conta no Mesaas.'
                    : 'Enviamos um link novo para o e-mail cadastrado no programa.'}
                </p>

                <div className="space-y-4">
                  {mode === 'signup' && (
                    <div className="space-y-1.5">
                      <Label htmlFor="af-nome">Nome</Label>
                      <Input
                        id="af-nome"
                        autoComplete="name"
                        required
                        maxLength={120}
                        value={nome}
                        onChange={(e) => setNome(e.target.value)}
                      />
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label htmlFor="af-email">E-mail</Label>
                    <Input
                      id="af-email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  {mode === 'signup' && (
                    <>
                      <div className="space-y-1.5">
                        <Label htmlFor="af-telefone">WhatsApp (opcional)</Label>
                        <Input
                          id="af-telefone"
                          type="tel"
                          autoComplete="tel"
                          placeholder="(11) 98888-7777"
                          value={telefone}
                          onChange={(e) => setTelefone(e.target.value)}
                        />
                      </div>
                      <div className="flex items-start gap-2">
                        <Checkbox
                          id="af-aceite"
                          checked={aceite}
                          onCheckedChange={(v) => setAceite(v === true)}
                          className="mt-0.5"
                        />
                        <Label htmlFor="af-aceite" className="text-sm font-normal leading-snug">
                          Li e aceito as regras do programa abaixo e os{' '}
                          <Link to="/termos-de-uso" className="underline">
                            Termos de Uso
                          </Link>
                          .
                        </Label>
                      </div>
                    </>
                  )}
                </div>

                {error && (
                  <p className="mt-4 text-sm text-[var(--danger-text)]" role="alert">
                    {error}
                  </p>
                )}

                <Button type="submit" className="mt-5 w-full" disabled={loading}>
                  {loading
                    ? 'Enviando…'
                    : mode === 'signup'
                      ? 'Cadastrar e receber meu link'
                      : 'Enviar link de acesso'}
                </Button>
                <button
                  type="button"
                  className="mt-3 w-full text-center text-sm text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => {
                    setError(null);
                    setMode(mode === 'signup' ? 'link' : 'signup');
                  }}
                >
                  {mode === 'signup'
                    ? 'Já sou afiliado: receber link de acesso'
                    : 'Ainda não sou afiliado: quero me cadastrar'}
                </button>
              </form>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="mb-3 text-lg font-semibold">Regras do programa</h2>
          <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            {RULES.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
