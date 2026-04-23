import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronDown, Instagram, Linkedin, Moon, Sun, Youtube } from 'lucide-react';

import {
  CalendarVisual,
  Calendar as CalendarIcon,
  CircleDollarSign,
  FinanceVisual,
  HeroDemo,
  HubVisual,
  IconSquare,
  InstagramVisual,
  Instagram as InstagramIcon,
  KanbanVisual,
  LayoutGrid,
  Users,
} from './landing-visuals';

import './landing.css';

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
}

export default function LandingPage() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.body.classList.add('landing-page');
    return () => document.body.classList.remove('landing-page');
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const els = root.querySelectorAll('.reveal');
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div ref={rootRef} className="lp-root">
      <Header />
      <Hero />
      <Ticker />
      <Features />
      <HowItWorks />
      <Testimonial />
      <Pricing />
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
    <header className="site-hdr">
      <div className="hdr-inner">
        <a href="#top" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
          <img src="/logo-black.svg" className="hdr-logo logo-light" alt="Mesaas" />
          <img src="/logo-white.svg" className="hdr-logo logo-dark" alt="Mesaas" />
        </a>
        <nav className="hdr-nav">
          <button onClick={() => scrollTo('features')}>Funcionalidades</button>
          <button onClick={() => scrollTo('how')}>Como funciona</button>
          <button onClick={() => scrollTo('pricing')}>Preços</button>
          <button onClick={() => scrollTo('faq')}>FAQ</button>
        </nav>
        <div className="hdr-actions">
          <button
            onClick={toggleTheme}
            className="theme-toggle"
            aria-label="Alternar tema"
          >
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <a href="/login" className="link">
            Entrar
          </a>
          <a href="/login?tab=register" className="lp-btn lp-btn-primary">
            Criar conta grátis
          </a>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="hero-wrap" id="top">
      <div className="lp-container">
        <div className="hero-grid">
          <div>
            <span className="eyebrow-pill">Beta aberto · 100% gratuito</span>
            <h1 className="hero-title">
              Sua agência de social media <em>sem caos</em>, sem planilha, sem grupo de WhatsApp.
            </h1>
            <p className="hero-sub">
              Mesaas é o CRM feito para gestores e agências de social media. Clientes, contratos, entregas, aprovações e métricas do Instagram — em um só lugar.
            </p>
            <div className="hero-ctas">
              <a href="/login?tab=register" className="lp-btn lp-btn-primary lg">
                Criar conta grátis <ArrowRight size={16} />
              </a>
              <button onClick={() => scrollTo('features')} className="lp-btn lp-btn-outline lg">
                Ver como funciona
              </button>
            </div>
          </div>
          <div className="hero-stage">
            <HeroDemo />
          </div>
        </div>
      </div>
    </section>
  );
}

function Ticker() {
  const items = [
    'Clientes + contratos',
    'Kanban de entregas',
    'Portal do cliente',
    'Integração Instagram',
    'Calendário editorial',
    'Financeiro',
    'Equipe + tarefas',
    'Aprovações por link',
    'Métricas reais',
    'Agendamento automático',
  ];
  const doubled = [...items, ...items];
  return (
    <div className="ticker" aria-hidden="true">
      <div className="ticker-track">
        {doubled.map((t, i) => (
          <span className="ticker-item" key={i}>
            <span className="bullet" />
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

function Features() {
  return (
    <section className="lp-pad" id="features">
      <div className="lp-container">
        <div className="section-head reveal">
          <span className="eyebrow-pill">Funcionalidades</span>
          <h2>Tudo que sua agência já faz — só que organizado.</h2>
          <p>Cada módulo foi desenhado com quem passa o dia gerenciando social media. Menos abas abertas, mais entrega.</p>
        </div>

        <div className="feat-row reveal">
          <div className="feat-copy">
            <IconSquare icon={<LayoutGrid size={22} />} color="#FFBF30" />
            <h3>Kanban de entregas que sua equipe entende no primeiro dia</h3>
            <p>Arraste cada post pelas etapas — da ideia à publicação. Cada cliente, cada tipo de conteúdo, cada prazo em um só fluxo visual.</p>
            <ul className="feat-bullets">
              <li>
                <span className="check">✓</span>
                <span>
                  <strong>5 etapas padrão</strong> — ideia, produção, aprovação, agendado, publicado
                </span>
              </li>
              <li>
                <span className="check">✓</span>
                <span>
                  Cards mostram <strong>cliente, tipo, prazo e status</strong> em um olhar
                </span>
              </li>
              <li>
                <span className="check">✓</span>
                <span>
                  <strong>Cards atrasados</strong> ficam destacados em vermelho automaticamente
                </span>
              </li>
              <li>
                <span className="check">✓</span>
                <span>Filtre por cliente ou tipo de conteúdo com um clique</span>
              </li>
            </ul>
          </div>
          <div className="feat-visual">
            <KanbanVisual />
          </div>
        </div>

        <div className="feat-row reverse reveal">
          <div className="feat-copy">
            <IconSquare icon={<InstagramIcon size={22} />} color="#f542c8" />
            <h3>Instagram conectado. Métricas reais, sem exportar CSV.</h3>
            <p>
              Conecte a conta do seu cliente via API oficial do Meta. Seguidores, alcance, engajamento e top posts atualizados todo dia, prontos para o
              relatório.
            </p>
            <ul className="feat-bullets">
              <li>
                <span className="check">✓</span>
                <span>
                  <strong>API oficial do Meta</strong> — dados confiáveis, sem scraping
                </span>
              </li>
              <li>
                <span className="check">✓</span>
                <span>
                  Crescimento de seguidores, <strong>alcance e engajamento</strong> por período
                </span>
              </li>
              <li>
                <span className="check">✓</span>
                <span>Top posts da semana destacados automaticamente</span>
              </li>
              <li>
                <span className="check">✓</span>
                <span>Relatório em PDF para enviar ao cliente em um clique</span>
              </li>
            </ul>
          </div>
          <div className="feat-visual">
            <InstagramVisual />
          </div>
        </div>

        <div className="feat-row reveal">
          <div className="feat-copy">
            <IconSquare icon={<Users size={22} />} color="#42c8f5" />
            <h3>Portal do cliente que o cliente realmente usa</h3>
            <p>
              Seu cliente aprova posts, vê o calendário e conversa com a equipe por um link único — <strong>sem login, sem app, sem fricção</strong>. Design
              editorial pensado para a marca dele, não para a sua CRM.
            </p>
            <ul className="feat-bullets">
              <li>
                <span className="check">✓</span>
                <span>
                  Link único <strong>sem necessidade de conta</strong> para o cliente
                </span>
              </li>
              <li>
                <span className="check">✓</span>
                <span>Aprovar, pedir ajustes ou comentar em cada post</span>
              </li>
              <li>
                <span className="check">✓</span>
                <span>
                  Calendário editorial e biblioteca de <strong>identidade de marca</strong>
                </span>
              </li>
              <li>
                <span className="check">✓</span>
                <span>Notificação automática quando algo precisa de decisão</span>
              </li>
            </ul>
          </div>
          <div className="feat-visual">
            <HubVisual />
          </div>
        </div>

        <div className="feat-row reverse reveal">
          <div className="feat-copy">
            <IconSquare icon={<CalendarIcon size={22} />} color="#3ecf8e" />
            <h3>Calendário editorial por cliente ou unificado</h3>
            <p>
              Veja tudo que foi planejado, agendado e publicado em um mês. Troque entre clientes ou visualize toda a operação de uma vez para identificar
              semanas vazias antes que virem problema.
            </p>
            <ul className="feat-bullets">
              <li>
                <span className="check">✓</span>
                <span>
                  Visão <strong>mensal, semanal e por cliente</strong>
                </span>
              </li>
              <li>
                <span className="check">✓</span>
                <span>Cores por tipo de conteúdo: Feed, Reels, Story, Carrossel</span>
              </li>
              <li>
                <span className="check">✓</span>
                <span>
                  Arraste para <strong>reagendar</strong> em segundos
                </span>
              </li>
              <li>
                <span className="check">✓</span>
                <span>Integração direta com o agendamento automático</span>
              </li>
            </ul>
          </div>
          <div className="feat-visual">
            <CalendarVisual />
          </div>
        </div>

        <div className="feat-row reveal">
          <div className="feat-copy">
            <IconSquare icon={<CircleDollarSign size={22} />} color="#6b7280" />
            <h3>Financeiro sem planilha paralela</h3>
            <p>
              Contratos, mensalidades e despesas da operação em um lugar só. Saiba o MRR da sua agência, quais clientes estão em aberto e quanto sobra no fim
              do mês — sem abrir o Excel.
            </p>
            <ul className="feat-bullets">
              <li>
                <span className="check">✓</span>
                <span>
                  MRR, <strong>receita prevista e em aberto</strong> em tempo real
                </span>
              </li>
              <li>
                <span className="check">✓</span>
                <span>Contratos com datas de renovação automáticas</span>
              </li>
              <li>
                <span className="check">✓</span>
                <span>Exportação de CSV para seu contador</span>
              </li>
              <li>
                <span className="check">✓</span>
                <span>
                  <strong>Despesas da operação</strong> vinculadas ao cliente que geraram
                </span>
              </li>
            </ul>
          </div>
          <div className="feat-visual">
            <FinanceVisual />
          </div>
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      n: '01',
      t: 'Cadastre sua agência',
      d: 'Crie sua conta grátis, importe seus clientes e configure templates de contrato. Simples como digitar um e-mail.',
    },
    {
      n: '02',
      t: 'Monte o fluxo de entregas',
      d: 'Arraste os posts pelo kanban. Atribua à equipe, defina prazos, conecte o Instagram de cada cliente.',
    },
    {
      n: '03',
      t: 'Compartilhe o link do Hub',
      d: 'Seu cliente aprova posts, acompanha o calendário e vê métricas — tudo por um link único, sem precisar criar conta.',
    },
  ];

  return (
    <section className="lp-pad lp-pad-alt" id="how">
      <div className="lp-container">
        <div className="section-head reveal">
          <span className="eyebrow-pill">Do zero em 5 minutos</span>
          <h2>Três passos entre você e uma operação organizada.</h2>
        </div>
        <div className="how-grid">
          {steps.map((s, i) => (
            <div key={i} className="how-step reveal">
              <span className="how-num">{s.n}</span>
              <span className="eyebrow-micro">Passo {s.n}</span>
              <h4>{s.t}</h4>
              <p>{s.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Testimonial() {
  return (
    <section className="quote-wrap">
      <div className="quote-card reveal">
        <div className="quote-mark">"</div>
        <blockquote>
          O Mesaas mudou completamente a forma como gerencio meus clientes. Antes eu vivia perdida em planilhas e grupos de WhatsApp — agora tudo fica em um só
          lugar e consigo entregar com muito mais qualidade e no prazo.
        </blockquote>
        <cite>
          <div className="quote-avatar">DK</div>
          <div className="quote-who">
            <div className="n">Débora Kristin</div>
            <div className="r">Founder · DK Marketing Médico</div>
          </div>
        </cite>
      </div>
    </section>
  );
}

function Pricing() {
  const plans = [
    {
      name: 'Free',
      price: 'R$ 0',
      tag: 'Para conhecer a plataforma.',
      limits: [
        ['Clientes', '2'],
        ['Usuários', '1'],
        ['Templates', '2'],
      ] as const,
      feats: [
        { t: 'Planejamento', y: true },
        { t: 'Calendário', y: true },
        { t: 'Integração Instagram', y: false },
        { t: 'Portal do cliente', y: false },
      ],
      cta: 'Começar grátis',
      highlight: false,
    },
    {
      name: 'Start',
      price: 'R$ 99,90',
      tag: 'Para freelancers que estão começando.',
      limits: [
        ['Clientes', '5'],
        ['Usuários', '1'],
        ['Templates', '3'],
      ] as const,
      feats: [
        { t: 'Planejamento', y: true },
        { t: 'Calendário', y: true },
        { t: 'Integração Instagram', y: true },
        { t: 'Portal do cliente', y: true },
      ],
      cta: 'Assinar Start',
      highlight: false,
    },
    {
      name: 'Pro',
      price: 'R$ 139,90',
      tag: 'Para freelancers com carteira consolidada.',
      limits: [
        ['Clientes', '15'],
        ['Usuários', '2'],
        ['Templates', '8'],
      ] as const,
      feats: [
        { t: 'Planejamento', y: true },
        { t: 'Calendário', y: true },
        { t: 'Integração Instagram', y: true },
        { t: 'Portal do cliente', y: true },
        { t: 'Agendamento automático', y: true },
        { t: 'Métricas avançadas', y: true },
      ],
      cta: 'Assinar Pro',
      highlight: true,
    },
    {
      name: 'Scale',
      price: 'R$ 199,90',
      tag: 'Para micro-agências e equipes completas.',
      limits: [
        ['Clientes', 'Ilimitado'],
        ['Usuários', 'Ilimitado'],
        ['Templates', 'Ilimitado'],
      ] as const,
      feats: [
        { t: 'Planejamento', y: true },
        { t: 'Calendário', y: true },
        { t: 'Integração Instagram', y: true },
        { t: 'Portal do cliente', y: true },
        { t: 'Agendamento automático', y: true },
        { t: 'Métricas avançadas', y: true },
      ],
      cta: 'Assinar Scale',
      highlight: false,
    },
  ];

  return (
    <section className="lp-pad" id="pricing">
      <div className="lp-container">
        <div className="section-head reveal">
          <span className="eyebrow-pill">Em breve · Beta 100% grátis</span>
          <h2>Um plano que cresce junto com a sua agência.</h2>
          <p>Enquanto o Mesaas está em beta, é totalmente gratuito. Estes são os planos que entrarão em vigor nos próximos meses.</p>
        </div>
        <div className="plans-grid">
          {plans.map((p) => (
            <div key={p.name} className={`plan-card reveal ${p.highlight ? 'highlight' : ''}`}>
              {p.highlight && <div className="plan-badge">Mais popular</div>}
              <h3>{p.name}</h3>
              <div className="price-row">
                <span className="price">{p.price}</span>
                <span className="price-sub">/mês</span>
              </div>
              <div className="plan-tag">{p.tag}</div>
              <div className="plan-label">Limites</div>
              <ul className="plan-list plan-limits">
                {p.limits.map(([k, v]) => (
                  <li key={k}>
                    <span className="k">{k}</span>
                    <span className="v">{v}</span>
                  </li>
                ))}
              </ul>
              <div className="plan-label">Features</div>
              <ul className="plan-list plan-feats">
                {p.feats.map((f) => (
                  <li key={f.t}>
                    {f.y ? <span className="ck">✓</span> : <span className="xk">✕</span>}
                    <span className={f.y ? '' : 'strike'}>{f.t}</span>
                  </li>
                ))}
              </ul>
              <div className="plan-cta">
                {p.highlight ? (
                  <span className="lp-btn lp-btn-primary">
                    {p.cta} · Em breve
                  </span>
                ) : (
                  <span className="soon">
                    {p.cta} · Em breve
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Faq() {
  const [open, setOpen] = useState<number | null>(null);

  const items = [
    {
      q: 'O Mesaas é gratuito mesmo?',
      a: 'Sim. Durante a fase beta, todas as funcionalidades são 100% gratuitas para todos os usuários. Quando os planos entrarem em vigor, quem já estava dentro recebe condições especiais.',
    },
    {
      q: 'Preciso instalar alguma coisa?',
      a: 'Não. O Mesaas é 100% web e funciona em qualquer navegador moderno, no computador ou no celular. Nada para baixar, nada para configurar.',
    },
    {
      q: 'Meu cliente precisa criar uma conta para usar o Hub?',
      a: 'Não. O portal de aprovação é acessado por um link único que você envia ao cliente. Ele abre, aprova, comenta — sem login, sem senha, sem app.',
    },
    {
      q: 'Como funciona a integração com o Instagram?',
      a: 'Você conecta a conta do seu cliente via API oficial do Meta. A partir daí, o Mesaas puxa métricas de seguidores, alcance, engajamento e posts automaticamente. Nada de scraping — dados 100% confiáveis.',
    },
    {
      q: 'Consigo importar meus clientes de uma planilha?',
      a: 'Sim. Você pode cadastrar cliente por cliente em segundos, ou importar via planilha. Em minutos sua base inteira está dentro do sistema.',
    },
    {
      q: 'Funciona para freelancer ou só para agência?',
      a: 'Para os dois. O plano Start atende freelancers começando, e o Scale suporta agências com dezenas de clientes e uma equipe inteira.',
    },
    {
      q: 'Posso cancelar quando quiser?',
      a: 'Sim, a qualquer momento. Sem multa, sem burocracia. Seus dados continuam exportáveis por mais 30 dias após o cancelamento.',
    },
  ];

  return (
    <section className="lp-pad lp-pad-alt" id="faq">
      <div className="lp-container">
        <div className="section-head reveal">
          <span className="eyebrow-pill">FAQ</span>
          <h2>Perguntas frequentes</h2>
        </div>
        <div className="faqs">
          {items.map((item, i) => (
            <div key={i} className="faq-item">
              <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i} aria-controls={`faq-answer-${i}`}>
                <span>{item.q}</span>
                <ChevronDown className={`faq-chevron ${open === i ? 'open' : ''}`} />
              </button>
              {open === i && (
                <div id={`faq-answer-${i}`} className="ans">
                  {item.a}
                </div>
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
    <section className="cta-final-wrap">
      <div className="lp-container">
        <div className="cta-final-card reveal">
          <img src="/icon.svg" style={{ height: 44, margin: '0 auto 22px', display: 'block' }} alt="" />
          <h2>Pronto para sair das planilhas?</h2>
          <p>Crie sua conta grátis e comece a organizar sua agência hoje. Sem cartão, sem compromisso.</p>
          <a href="/login?tab=register" className="lp-btn lp-btn-primary lg">
            Criar conta grátis <ArrowRight size={16} />
          </a>
          <div
            style={{
              marginTop: 18,
              fontSize: '.8rem',
              color: '#9ca3af',
              fontFamily: "ui-monospace,'SF Mono',Menlo,monospace",
              letterSpacing: '.08em',
            }}
          >
            BETA ABERTO · 100% GRATUITO
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="lp-footer">
      <div className="lp-container">
        <div className="footer-grid">
          <div className="footer-col">
            <img src="/logo-black.svg" style={{ height: 22 }} className="logo-light" alt="Mesaas" />
            <img src="/logo-white.svg" style={{ height: 22 }} className="logo-dark" alt="Mesaas" />
            <p className="footer-tag">Gestão inteligente para social media managers. Feito no Brasil, pensado para quem entrega conteúdo todo dia.</p>
          </div>
          <div className="footer-col">
            <h5>Produto</h5>
            <ul>
              <li>
                <a href="#features">Funcionalidades</a>
              </li>
              <li>
                <a href="#how">Como funciona</a>
              </li>
              <li>
                <a href="#pricing">Preços</a>
              </li>
              <li>
                <a href="#faq">FAQ</a>
              </li>
            </ul>
          </div>
          <div className="footer-col">
            <h5>Legal</h5>
            <ul>
              <li>
                <a href="/politica-de-privacidade">Privacidade</a>
              </li>
              <li>
                <a href="/termos-de-uso">Termos de uso</a>
              </li>
              <li>
                <a href="/lgpd">LGPD</a>
              </li>
            </ul>
          </div>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© 2025 Mesaas. Todos os direitos reservados. · CNPJ 63.758.902/0001-01 — EBS IT SOLUTIONS</span>
        <div className="footer-socials">
          <a href="#">
            <Instagram size={18} />
          </a>
          <a href="#">
            <Linkedin size={18} />
          </a>
          <a href="#">
            <Youtube size={18} />
          </a>
        </div>
      </div>
    </footer>
  );
}
