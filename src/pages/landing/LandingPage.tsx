import { useState } from 'react';
import { Users, CheckSquare, ExternalLink, Calendar, ChevronDown } from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <Hero />
      <Testimonial />
      <Features />
      <Faq />
      <CtaFinal />
      <Footer />
    </div>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <span className="text-xl font-bold tracking-tight">Mesaas</span>
        <nav className="hidden gap-6 text-sm text-muted-foreground md:flex">
          <a href="#features" className="hover:text-foreground transition-colors">Funcionalidades</a>
          <a href="#faq" className="hover:text-foreground transition-colors">FAQ</a>
        </nav>
        <a
          href="/login"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
        >
          Criar conta grátis
        </a>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24 text-center">
      <h1 className="mx-auto max-w-4xl text-4xl font-extrabold leading-tight tracking-tight md:text-5xl lg:text-6xl">
        Sua agência de social media com clientes organizados, entregas no prazo e relatórios em um só lugar
      </h1>
      <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
        Mesaas é o CRM feito para gestores e agências de social media. Gerencie clientes, workflows de entrega, financeiro e aprovações — sem planilha, sem caos.
      </p>
      <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
        <a
          href="/login"
          className="rounded-md bg-primary px-6 py-3 text-base font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
        >
          Criar conta grátis
        </a>
        <a
          href="#features"
          className="text-base font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          Ver como funciona →
        </a>
      </div>
    </section>
  );
}

function Testimonial() {
  return (
    <section className="bg-muted/40 py-16">
      <div className="mx-auto max-w-3xl px-6 text-center">
        <blockquote className="text-xl font-medium leading-relaxed text-foreground">
          "[PLACEHOLDER — inserir depoimento real da agência beta]"
        </blockquote>
        <p className="mt-4 text-sm text-muted-foreground">
          — <strong>[Nome]</strong>, [Agência]
        </p>
      </div>
    </section>
  );
}

function Features() {
  const items = [
    {
      icon: <Users className="h-6 w-6 text-primary" />,
      title: 'Clientes e contratos organizados',
      description:
        'Cadastro de clientes, contratos, histórico e dados financeiros em um só lugar. Chega de informação espalhada.',
    },
    {
      icon: <CheckSquare className="h-6 w-6 text-primary" />,
      title: 'Workflows de entrega sem atrito',
      description:
        'Crie etapas de produção, atribua tarefas à equipe e acompanhe o status de cada entrega em tempo real.',
    },
    {
      icon: <ExternalLink className="h-6 w-6 text-primary" />,
      title: 'Portal de aprovação para o cliente',
      description:
        'Seu cliente aprova posts, deixa comentários e acompanha o progresso — sem precisar de login nem acesso ao sistema interno.',
    },
    {
      icon: <Calendar className="h-6 w-6 text-primary" />,
      title: 'Calendário e visão geral de conteúdo',
      description:
        'Veja todos os posts agendados e entregues por cliente em um calendário unificado, com status de cada publicação.',
    },
  ];

  return (
    <section id="features" className="mx-auto max-w-6xl px-6 py-24">
      <h2 className="text-center text-3xl font-bold tracking-tight md:text-4xl">
        Tudo que sua agência precisa em um só lugar
      </h2>
      <div className="mt-14 grid gap-8 md:grid-cols-2">
        {items.map((item) => (
          <div key={item.title} className="rounded-xl border border-border bg-card p-8">
            <div className="mb-4">{item.icon}</div>
            <h3 className="mb-2 text-lg font-semibold">{item.title}</h3>
            <p className="text-muted-foreground">{item.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Faq() {
  const [open, setOpen] = useState<number | null>(null);

  const items = [
    {
      q: 'É gratuito?',
      a: 'Sim, o Mesaas está em fase beta e é totalmente gratuito agora. Crie sua conta e comece hoje.',
    },
    {
      q: 'Preciso instalar alguma coisa?',
      a: 'Não. É 100% web, funciona em qualquer navegador.',
    },
    {
      q: 'Consigo migrar meus clientes de planilhas?',
      a: 'Sim, o cadastro é simples e rápido. Em minutos seus clientes estão dentro do sistema.',
    },
    {
      q: 'Meu cliente precisa criar uma conta para usar o portal?',
      a: 'Não. O portal de aprovação é acessado por um link único, sem login.',
    },
    {
      q: 'Funciona para freelancers ou só para agências?',
      a: 'Para os dois. Você pode gerenciar de 1 a dezenas de clientes.',
    },
    {
      q: 'Como faço para começar?',
      a: 'Clique em "Criar conta grátis", cadastre sua agência e comece a usar imediatamente.',
    },
  ];

  return (
    <section id="faq" className="bg-muted/40 py-24">
      <div className="mx-auto max-w-3xl px-6">
        <h2 className="mb-12 text-center text-3xl font-bold tracking-tight md:text-4xl">
          Perguntas frequentes
        </h2>
        <div className="divide-y divide-border rounded-xl border border-border bg-card">
          {items.map((item, i) => (
            <div key={i}>
              <button
                className="flex w-full items-center justify-between px-6 py-5 text-left font-medium hover:bg-muted/30 transition-colors"
                onClick={() => setOpen(open === i ? null : i)}
                aria-expanded={open === i}
                aria-controls={`faq-answer-${i}`}
              >
                <span>{item.q}</span>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open === i ? 'rotate-180' : ''}`}
                />
              </button>
              {open === i && (
                <div id={`faq-answer-${i}`} className="px-6 pb-5 text-muted-foreground">{item.a}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CtaFinal() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24 text-center">
      <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
        Pronto para sair das planilhas?
      </h2>
      <p className="mt-4 text-lg text-muted-foreground">
        Crie sua conta grátis e comece a organizar sua agência hoje.
      </p>
      <a
        href="/login"
        className="mt-8 inline-block rounded-md bg-primary px-8 py-3 text-base font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
      >
        Criar conta grátis
      </a>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border py-8">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-6 text-sm text-muted-foreground sm:flex-row sm:justify-between">
        <span className="font-semibold text-foreground">Mesaas</span>
        <div className="flex gap-6">
          <a href="/politica-de-privacidade" className="hover:text-foreground transition-colors">
            Política de Privacidade
          </a>
        </div>
        <span>© 2025 Mesaas. Todos os direitos reservados.</span>
      </div>
    </footer>
  );
}
