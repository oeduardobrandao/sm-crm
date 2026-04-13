import { useEffect, useState } from 'react';
import { Users, CheckSquare, ExternalLink, Calendar, ChevronDown, Sun, Moon } from 'lucide-react';
import logoBlack from '/logo-black.svg';
import logoWhite from '/logo-white.svg';

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
}

export default function LandingPage() {
  useEffect(() => {
    document.body.classList.add('landing-page');
    return () => document.body.classList.remove('landing-page');
  }, []);

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
  const [isDark, setIsDark] = useState(document.documentElement.getAttribute('data-theme') === 'dark');

  const toggleTheme = () => {
    const next = !isDark;
    if (next) document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    setIsDark(next);
  };

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 md:px-6">
        <img src={logoBlack} alt="Mesaas" className="h-6 w-auto dark:hidden md:h-7" />
        <img src={logoWhite} alt="Mesaas" className="h-6 w-auto hidden dark:block md:h-7" />
        <nav className="hidden gap-6 text-sm font-medium text-muted-foreground md:flex">
          <button onClick={() => scrollTo('features')} className="hover:text-foreground transition-colors">Funcionalidades</button>
          <button onClick={() => scrollTo('faq')} className="hover:text-foreground transition-colors">FAQ</button>
        </nav>
        <div className="flex items-center gap-3 md:gap-4">
          <button
            onClick={toggleTheme}
            className="rounded-md p-2 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Alternar tema"
          >
            {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </button>
          <a
            href="/login"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors md:text-base"
          >
            Entrar
          </a>
          <a
            href="/login?tab=register"
            className="rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity shadow-sm md:px-5 md:py-2.5 md:text-base"
          >
            <span className="hidden sm:inline">Criar conta grátis</span>
            <span className="sm:hidden">Começar</span>
          </a>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-16 text-center sm:py-20 md:py-28 md:px-6">
      <h1 className="mx-auto max-w-4xl text-4xl font-extrabold leading-[1.15] tracking-tight sm:text-3xl md:text-5xl lg:text-6xl">
        Sua agência de social media com clientes organizados, entregas no prazo e relatórios em um só lugar
      </h1>
      <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground md:mt-8 md:text-xl leading-relaxed">
        Mesaas é o CRM feito para gestores e agências de social media. Gerencie clientes, workflows de entrega, financeiro e aprovações — sem planilha, sem caos.
      </p>
      <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center md:mt-12">
        <a
          href="/login?tab=register"
          className="flex w-full items-center justify-center rounded-lg bg-primary px-8 py-4 text-lg font-semibold text-primary-foreground shadow-xl shadow-primary/20 hover:opacity-90 transition-all active:scale-95 sm:w-auto"
        >
          Criar conta grátis
        </a>
        <button
          onClick={() => scrollTo('features')}
          className="flex w-full items-center justify-center rounded-lg border-2 border-border bg-background px-8 py-4 text-lg font-semibold text-foreground hover:bg-muted transition-all active:scale-95 sm:w-auto"
        >
          Ver como funciona →
        </button>
      </div>
    </section>
  );
}

function Testimonial() {
  return (
    <section className="bg-muted/30 py-20 px-5">
      <div className="mx-auto max-w-3xl text-center">
        <blockquote className="text-xl font-medium leading-relaxed text-foreground md:text-2xl">
          "O Mesaas mudou completamente a forma como gerencio meus clientes. Antes eu vivia perdida em planilhas e grupos de WhatsApp — agora tudo fica em um só lugar e consigo entregar com muito mais qualidade e no prazo."
        </blockquote>
        <p className="mt-4 text-sm text-muted-foreground">
          — <strong>Débora Kristin</strong>, DK Marketing Médico
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
    <section id="features" className="mx-auto max-w-6xl px-5 py-20 md:px-6 md:py-28">
      <h2 className="text-center text-3xl font-bold tracking-tight md:text-4xl lg:text-5xl">
        Tudo que sua agência precisa em um só lugar
      </h2>
      <div className="mt-12 grid gap-6 md:mt-16 md:grid-cols-2 md:gap-8">
        {items.map((item) => (
          <div key={item.title} className="rounded-2xl border border-border bg-card p-8 shadow-sm transition-shadow hover:shadow-md md:p-10">
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
    <section id="faq" className="bg-muted/30 py-20 md:py-28">
      <div className="mx-auto max-w-3xl px-5 md:px-6">
        <h2 className="mb-10 text-center text-3xl font-bold tracking-tight md:mb-14 md:text-4xl lg:text-5xl">
          Perguntas frequentes
        </h2>
        <div className="divide-y divide-border rounded-2xl border border-border bg-card shadow-sm">
          {items.map((item, i) => (
            <div key={i}>
              <button
                className="flex w-full items-center justify-between px-6 py-6 text-left text-lg font-medium hover:bg-muted/30 transition-colors md:px-8"
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
                <div id={`faq-answer-${i}`} className="px-6 pb-6 text-muted-foreground md:px-8 md:text-lg">{item.a}</div>
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
    <section className="mx-auto max-w-6xl px-5 py-20 text-center md:px-6 md:py-32">
      <h2 className="text-3xl font-bold tracking-tight md:text-5xl">
        Pronto para sair das planilhas?
      </h2>
      <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground md:text-xl">
        Crie sua conta grátis e comece a organizar sua agência hoje.
      </p>
      <div className="mt-10 flex justify-center">
        <a
          href="/login?tab=register"
          className="flex w-full items-center justify-center rounded-lg bg-primary px-8 py-4 text-lg font-semibold text-primary-foreground shadow-xl shadow-primary/20 hover:opacity-90 transition-all active:scale-95 sm:w-auto"
        >
          Criar conta grátis
        </a>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border py-10 md:py-12">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-6 text-sm text-muted-foreground sm:flex-row sm:justify-between">
        <img src={logoBlack} alt="Mesaas" className="h-6 w-auto dark:hidden md:h-7" />
        <img src={logoWhite} alt="Mesaas" className="h-6 w-auto hidden dark:block md:h-7" />
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
