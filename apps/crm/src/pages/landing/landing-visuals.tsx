import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Calendar,
  CalendarClock,
  Check,
  CheckCircle2,
  CircleDollarSign,
  Clock,
  ExternalLink,
  Filter,
  Heart,
  Instagram,
  LayoutGrid,
  Link as LinkIcon,
  MessageCircle,
  MousePointer2,
  Plus,
  Send,
  Users,
} from 'lucide-react';

const BRAND = {
  yellow: '#FFBF30',
  yellowHover: '#ca8a04',
  green: '#3ecf8e',
  red: '#f55a42',
  orange: '#f5a342',
  teal: '#42c8f5',
  pink: '#f542c8',
  blue: '#3984FF',
  dark: '#12151a',
  text: '#374151',
  muted: '#6b7280',
  line: 'rgba(30,36,48,.08)',
  lineStrong: 'rgba(30,36,48,.14)',
};

function shade(hex: string, pct: number) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + pct * 2.55));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 0xff) + pct * 2.55));
  const b = Math.max(0, Math.min(255, (n & 0xff) + pct * 2.55));
  return '#' + ((1 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)).toString(16).slice(1);
}

function contrastFor(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const r = n >> 16,
    g = (n >> 8) & 0xff,
    b = n & 0xff;
  const y = (r * 299 + g * 587 + b * 114) / 1000;
  return y > 150 ? '#12151a' : '#fff';
}

function Avatar({ name, size = 28, bg }: { name: string; size?: number; bg?: string }) {
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
  const hues = [BRAND.yellow, BRAND.teal, BRAND.green, BRAND.pink, BRAND.blue, BRAND.orange];
  const hash = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const color = bg || hues[hash % hues.length];
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 9999,
        flexShrink: 0,
        background: `linear-gradient(135deg, ${color}, ${shade(color, -15)})`,
        color: contrastFor(color),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "-apple-system,'SF Pro Text','Plus Jakarta Sans',system-ui,sans-serif",
        fontWeight: 700,
        fontSize: size * 0.36,
        letterSpacing: '-.02em',
        border: '2px solid #fff',
        boxSizing: 'border-box',
      }}
    >
      {initials}
    </div>
  );
}

function Badge({ children, tone = 'neutral', small }: { children: React.ReactNode; tone?: string; small?: boolean }) {
  const palette: Record<string, { bg: string; fg: string }> = {
    neutral: { bg: '#f1f5f9', fg: '#374151' },
    success: { bg: 'rgba(62,207,142,.15)', fg: '#1e9e66' },
    warning: { bg: 'rgba(245,163,66,.15)', fg: '#b47011' },
    danger: { bg: 'rgba(245,90,66,.12)', fg: '#c23b22' },
    yellow: { bg: 'rgba(255,191,48,.18)', fg: '#a16207' },
    teal: { bg: 'rgba(66,200,245,.15)', fg: '#0e7a9b' },
    dark: { bg: '#12151a', fg: '#fff' },
  };
  const c = palette[tone] || palette.neutral;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        padding: small ? '2px 6px' : '3px 9px',
        borderRadius: 9999,
        background: c.bg,
        color: c.fg,
        fontFamily: "ui-monospace,'SF Mono',Menlo,monospace",
        fontSize: small ? '.55rem' : '.66rem',
        fontWeight: 600,
        letterSpacing: '.08em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

const MONO = "ui-monospace,'SF Mono',Menlo,monospace";

function useIsMobile(breakpoint = 640) {
  const [mobile, setMobile] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.innerWidth < breakpoint;
  });
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const handler = (e: MediaQueryListEvent) => setMobile(e.matches);
    setMobile(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [breakpoint]);
  return mobile;
}

export function HeroDemo() {
  const mobile = useIsMobile();
  const [revenue, setRevenue] = useState(0);
  useEffect(() => {
    let n = 0;
    const target = 12480;
    const id = setInterval(() => {
      n = Math.min(target, n + 420);
      setRevenue(n);
      if (n >= target) clearInterval(id);
    }, 24);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 520 }}>
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.35, zIndex: 0 }}>
        <defs>
          <pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse">
            <path d="M 28 0 L 0 0 0 28" fill="none" stroke="rgba(30,36,48,.06)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>

      {/* dashboard card */}
      <div
        style={{
          position: 'absolute',
          top: 20,
          left: '4%',
          right: '8%',
          background: '#fff',
          borderRadius: 18,
          boxShadow: '0 30px 80px -20px rgba(0,0,0,.18), 0 0 0 1px rgba(30,36,48,.06)',
          overflow: 'hidden',
          zIndex: 2,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '10px 14px',
            borderBottom: '1px solid rgba(30,36,48,.05)',
            background: '#fafbfc',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 9999, background: '#ff6058' }} />
            <span style={{ width: 10, height: 10, borderRadius: 9999, background: '#ffbd2e' }} />
            <span style={{ width: 10, height: 10, borderRadius: 9999, background: '#27c941' }} />
          </div>
          <div style={{ flex: 1, textAlign: 'center', fontSize: 11, color: '#6b7280', fontFamily: MONO, letterSpacing: '.05em' }}>
            mesaas.com.br/dashboard
          </div>
        </div>

        <div style={{ padding: '18px 20px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 14 }}>
            <div>
              <div className="eyebrow-micro" style={{ fontSize: '.6rem' }}>
                Visão Geral
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-.01em', color: BRAND.dark, marginTop: 4 }}>
                Olá, Débora
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 9px',
                borderRadius: 9999,
                background: 'rgba(62,207,142,.12)',
                color: '#1e9e66',
                fontSize: 10,
                fontWeight: 600,
                fontFamily: MONO,
                letterSpacing: '.06em',
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 9999,
                  background: '#3ecf8e',
                  animation: 'pulse-dot 2s ease-in-out infinite',
                }}
              />
              AO VIVO
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: 8 }}>
            <div
              style={{
                background: BRAND.dark,
                borderRadius: 12,
                padding: '14px 16px',
                color: '#fff',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '.14em', textTransform: 'uppercase', color: BRAND.yellow, fontWeight: 700 }}>
                Receita Mensal
              </div>
              <div style={{ fontSize: 26, fontWeight: 900, letterSpacing: '-.02em', marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
                R$ {revenue.toLocaleString('pt-BR')}
              </div>
              <div style={{ fontSize: 10, color: '#3ecf8e', marginTop: 2, fontWeight: 600 }}>↑ 8,2% vs abril</div>
              <svg width="90" height="32" style={{ position: 'absolute', right: 10, bottom: 10, opacity: 0.9 }}>
                <polyline
                  fill="none"
                  stroke={BRAND.yellow}
                  strokeWidth="1.8"
                  points="0,24 15,20 30,22 45,14 60,16 75,8 90,4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="90" cy="4" r="3" fill={BRAND.yellow} />
              </svg>
            </div>
            <div style={{ background: '#fff', borderRadius: 12, padding: '12px 14px', border: '1px solid rgba(30,36,48,.08)', borderLeft: `3px solid ${BRAND.green}` }}>
              <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '.12em', textTransform: 'uppercase', color: '#374151', fontWeight: 700 }}>Clientes</div>
              <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: '-.02em', marginTop: 4, color: BRAND.dark }}>7</div>
              <div style={{ fontSize: 10, color: BRAND.green, marginTop: 2, fontWeight: 600 }}>+1 novo</div>
            </div>
            <div style={{ background: '#fff', borderRadius: 12, padding: '12px 14px', border: '1px solid rgba(30,36,48,.08)', borderLeft: `3px solid ${BRAND.teal}` }}>
              <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '.12em', textTransform: 'uppercase', color: '#374151', fontWeight: 700 }}>Posts / mês</div>
              <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: '-.02em', marginTop: 4, color: BRAND.dark }}>42</div>
              <div style={{ fontSize: 10, color: BRAND.teal, marginTop: 2, fontWeight: 600 }}>12 aprovados</div>
            </div>
          </div>

          <div style={{ marginTop: 14, background: '#fafbfc', borderRadius: 12, padding: '12px 14px', border: '1px solid rgba(30,36,48,.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '.12em', textTransform: 'uppercase', color: '#374151', fontWeight: 700 }}>
                Receita · últimos 6 meses
              </div>
              <div style={{ display: 'flex', gap: 3 }}>
                <span style={{ padding: '2px 6px', fontSize: 9, fontWeight: 600, color: '#6b7280', background: '#fff', borderRadius: 6 }}>Mês</span>
                <span
                  style={{
                    padding: '2px 6px',
                    fontSize: 9,
                    fontWeight: 600,
                    color: BRAND.dark,
                    background: '#fff',
                    borderRadius: 6,
                    boxShadow: '0 1px 2px rgba(0,0,0,.05)',
                  }}
                >
                  Trim
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 60 }}>
              {(
                [
                  ['Nov', 58],
                  ['Dez', 44],
                  ['Jan', 72],
                  ['Fev', 62],
                  ['Mar', 80],
                  ['Abr', 96],
                ] as const
              ).map(([m, h], i) => (
                <div key={m} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div
                    style={{
                      width: '100%',
                      height: `${h}%`,
                      background: i === 5 ? `linear-gradient(180deg,${BRAND.yellow},${BRAND.yellowHover})` : 'rgba(30,36,48,.14)',
                      borderRadius: '4px 4px 2px 2px',
                      transformOrigin: 'bottom',
                      animation: `bar-grow .7s cubic-bezier(.22,1,.36,1) ${i * 0.08}s backwards`,
                    }}
                  />
                  <span style={{ fontSize: 8, color: '#9ca3af', fontFamily: MONO, letterSpacing: '.08em' }}>{m}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* floating kanban card */}
      <div
        style={{
          position: 'absolute',
          top: '46%',
          left: mobile ? 0 : '-2%',
          width: mobile ? '65%' : 230,
          background: '#fff',
          borderRadius: 20,
          padding: '14px 16px',
          boxShadow: '0 20px 50px -12px rgba(0,0,0,.18), 0 0 0 1px rgba(30,36,48,.06)',
          animation: 'float-up 4.5s ease-in-out infinite',
          zIndex: 3,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <Badge tone="yellow">Reels</Badge>
          <Badge tone="warning">Aprovação</Badge>
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: BRAND.dark, lineHeight: 1.3, marginBottom: 10 }}>
          Reels — Novo cardápio de inverno
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Avatar name="Café da Manhã" size={20} />
            <span style={{ fontSize: 10, color: '#6b7280', fontWeight: 500 }}>Café da Manhã</span>
          </div>
          <span style={{ fontSize: 10, color: '#6b7280', fontFamily: MONO, fontWeight: 600 }}>03/05</span>
        </div>
      </div>

      {/* floating approval toast */}
      <div
        style={{
          position: 'absolute',
          bottom: 8,
          right: mobile ? 0 : '-2%',
          width: mobile ? '70%' : 260,
          background: '#fff',
          borderRadius: 16,
          padding: '14px 16px',
          boxShadow: '0 20px 50px -12px rgba(0,0,0,.18), 0 0 0 1px rgba(30,36,48,.06)',
          display: 'flex',
          gap: 12,
          alignItems: 'flex-start',
          animation: 'float-up 5s ease-in-out .8s infinite',
          zIndex: 3,
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 9999,
            background: 'rgba(62,207,142,.14)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <CheckCircle2 size={22} color={BRAND.green} fill={BRAND.green} strokeWidth={0} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: BRAND.dark, marginBottom: 2 }}>Post aprovado</div>
          <div style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.4 }}>
            Bella Moda aprovou <strong style={{ color: BRAND.dark, fontWeight: 600 }}>Lançamento Coleção</strong>
          </div>
          <div style={{ fontSize: 9, color: '#9ca3af', fontFamily: MONO, marginTop: 4, letterSpacing: '.06em' }}>AGORA MESMO</div>
        </div>
      </div>
    </div>
  );
}

export function KanbanVisual() {
  const [phase, setPhase] = useState(0);
  const mobile = useIsMobile();
  useEffect(() => {
    const id = setInterval(() => setPhase((p) => (p + 1) % 3), 2800);
    return () => clearInterval(id);
  }, []);

  const cols = [
    { id: 'ideia', title: 'Ideia', color: '#6b7280', count: 3 },
    { id: 'producao', title: 'Produção', color: BRAND.teal, count: 2 },
    { id: 'aprovacao', title: 'Aprovação', color: BRAND.yellow, count: 4 },
    { id: 'agendado', title: 'Agendado', color: BRAND.green, count: 2 },
  ];
  const cards: Record<string, Array<{ t: string; c: string; tipo: string; tone: string; late?: boolean }>> = {
    ideia: [
      { t: 'Behind the scenes', c: 'Café da Manhã', tipo: 'Reels', tone: 'yellow' },
      { t: 'Carrossel institucional', c: 'Clínica Raiz', tipo: 'Carrossel', tone: 'teal' },
    ],
    producao: [{ t: 'Post Dia das Mães', c: 'Studio Vilma', tipo: 'Feed', tone: 'teal' }],
    aprovacao: [
      { t: 'Carrossel de outubro', c: 'Studio Vilma', tipo: 'Carrossel', tone: 'danger', late: true },
      { t: 'Story promocional', c: 'Bella Moda', tipo: 'Story', tone: 'yellow' },
    ],
    agendado: [{ t: 'Lançamento Coleção', c: 'Bella Moda', tipo: 'Feed', tone: 'success' }],
  };
  const movingCol = ['producao', 'aprovacao', 'agendado'][phase];
  const movingTone = ['teal', 'yellow', 'success'][phase];

  const renderCard = (c: { t: string; c: string; tipo: string; tone: string; late?: boolean }, i: number) => (
    <div
      key={i}
      style={{
        background: c.late ? 'rgba(245,90,66,.04)' : '#fff',
        border: `1px solid ${c.late ? 'rgba(245,90,66,.2)' : 'rgba(30,36,48,.08)'}`,
        borderRadius: 14,
        padding: '10px 11px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        boxShadow: '0 1px 2px rgba(0,0,0,.03)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Badge tone={c.tone} small>{c.tipo}</Badge>
        {c.late && (
          <span style={{ fontSize: 8, fontWeight: 700, color: BRAND.red, fontFamily: MONO, letterSpacing: '.08em' }}>ATRASADO</span>
        )}
      </div>
      <div style={{ fontSize: 11, fontWeight: 600, color: BRAND.dark, lineHeight: 1.3 }}>{c.t}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <Avatar name={c.c} size={16} />
        <span style={{ fontSize: 9.5, color: '#6b7280', fontWeight: 500 }}>{c.c}</span>
      </div>
    </div>
  );

  const renderMoving = () => (
    <div
      key={`moving-${phase}`}
      style={{
        background: '#fff',
        border: `2px solid ${BRAND.yellow}`,
        borderRadius: 14,
        padding: '10px 11px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        boxShadow: `0 10px 24px -6px rgba(255,191,48,.45), 0 0 0 4px rgba(255,191,48,.18)`,
        animation: 'card-drop-in .5s cubic-bezier(.22,1,.36,1)',
        transform: 'rotate(-1.5deg)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Badge tone={movingTone} small>Reels</Badge>
        <MousePointer2 size={14} color={BRAND.yellow} />
      </div>
      <div style={{ fontSize: 11, fontWeight: 700, color: BRAND.dark, lineHeight: 1.3 }}>Reels — Novo cardápio</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <Avatar name="Café da Manhã" size={16} />
        <span style={{ fontSize: 9.5, color: '#6b7280', fontWeight: 500 }}>Café da Manhã</span>
      </div>
    </div>
  );

  const renderCol = (col: (typeof cols)[number], minH?: number) => {
    const colCards = cards[col.id] || [];
    const showMoving = col.id === movingCol;
    return (
      <div key={col.id} style={{ background: '#f5f6f8', borderRadius: 14, padding: 10, minHeight: minH }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 4px 8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: 9999, background: col.color }} />
            <span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: BRAND.dark }}>
              {col.title}
            </span>
          </div>
          <span style={{ fontSize: 9, color: '#6b7280', fontWeight: 600, fontFamily: MONO }}>{col.count}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {colCards.map(renderCard)}
          {showMoving && renderMoving()}
        </div>
      </div>
    );
  };

  return (
    <div
      style={{
        background: '#fdfdfd',
        borderRadius: 20,
        padding: mobile ? 14 : 20,
        border: '1px solid rgba(30,36,48,.06)',
        boxShadow: '0 30px 80px -20px rgba(0,0,0,.15)',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: mobile ? 12 : 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <LayoutGrid size={18} color={BRAND.yellow} fill={BRAND.yellow} strokeWidth={0} />
          <span className="eyebrow-micro" style={{ fontSize: '.7rem' }}>
            Entregas · Maio
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <span
            style={{
              padding: '4px 10px',
              fontSize: 10,
              fontWeight: 600,
              color: '#6b7280',
              background: '#fff',
              border: '1px solid rgba(30,36,48,.08)',
              borderRadius: 8,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontFamily: MONO,
              letterSpacing: '.06em',
            }}
          >
            <Filter size={11} />
            FILTRAR
          </span>
          {!mobile && (
            <span
              style={{
                padding: '4px 10px',
                fontSize: 10,
                fontWeight: 700,
                color: BRAND.dark,
                background: BRAND.yellow,
                borderRadius: 8,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontFamily: MONO,
                letterSpacing: '.06em',
              }}
            >
              <Plus size={11} strokeWidth={3} />
              NOVA ENTREGA
            </span>
          )}
        </div>
      </div>

      {mobile ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {cols.map((col) => renderCol(col))}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
          {cols.map((col) => renderCol(col, 260))}
        </div>
      )}
    </div>
  );
}

export function InstagramVisual() {
  const [animKey, setAnimKey] = useState(0);
  const mobile = useIsMobile();
  useEffect(() => {
    const id = setInterval(() => setAnimKey((k) => k + 1), 6000);
    return () => clearInterval(id);
  }, []);

  const followerPoints = [
    [0, 70],
    [1, 72],
    [2, 68],
    [3, 74],
    [4, 78],
    [5, 76],
    [6, 82],
    [7, 88],
    [8, 86],
    [9, 94],
    [10, 92],
    [11, 100],
  ];
  const W = 360,
    H = 140,
    padL = 26,
    padB = 18;
  const xScale = (i: number) => padL + (i / 11) * (W - padL - 16);
  const yScale = (v: number) => H - padB - (v / 100) * (H - padB - 10);
  const path = followerPoints.map(([i, v], idx) => `${idx === 0 ? 'M' : 'L'}${xScale(i)},${yScale(v)}`).join(' ');
  const area = path + ` L${xScale(11)},${H - padB} L${xScale(0)},${H - padB} Z`;

  const metrics = [
    { l: 'Seguidores', v: '12.840', d: '+318 · 7d', tone: BRAND.green },
    { l: 'Alcance', v: '84,2K', d: '+12% sem', tone: BRAND.teal },
    { l: 'Engajamento', v: '6,8%', d: 'Acima da média', tone: BRAND.yellow },
  ];

  return (
    <div
      style={{
        background: BRAND.dark,
        borderRadius: 22,
        padding: mobile ? 16 : 22,
        color: '#fff',
        boxShadow: '0 30px 80px -20px rgba(0,0,0,.3)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: -60,
          right: -60,
          width: 220,
          height: 220,
          borderRadius: 9999,
          background: 'radial-gradient(closest-side,rgba(255,191,48,.3),transparent)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: -80,
          left: -40,
          width: 240,
          height: 240,
          borderRadius: 9999,
          background: 'radial-gradient(closest-side,rgba(245,66,200,.2),transparent)',
          pointerEvents: 'none',
        }}
      />

      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              background: 'linear-gradient(135deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Instagram size={18} color="#fff" />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', letterSpacing: '-.01em' }}>@cafe.damanha</div>
            <div style={{ fontSize: 10, color: '#9ca3af', fontFamily: MONO, letterSpacing: '.06em' }}>CONECTADO · SYNC 2 MIN</div>
          </div>
        </div>
        <span
          style={{
            padding: '4px 10px',
            borderRadius: 9999,
            background: 'rgba(62,207,142,.18)',
            color: '#3ecf8e',
            fontSize: 10,
            fontWeight: 700,
            fontFamily: MONO,
            letterSpacing: '.08em',
          }}
        >
          ● ONLINE
        </span>
      </div>

      <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: mobile ? '1fr 1fr' : 'repeat(3,1fr)', gap: 10, marginBottom: 14 }}>
        {metrics.map((m, i) => (
          <div
            key={i}
            style={{
              background: 'rgba(255,255,255,.04)',
              border: '1px solid rgba(255,255,255,.06)',
              borderRadius: 12,
              padding: '10px 12px',
              ...(mobile && i === 2 ? { gridColumn: '1 / -1' } : {}),
            }}
          >
            <div style={{ fontSize: 9, fontWeight: 600, color: '#9ca3af', fontFamily: MONO, letterSpacing: '.1em', textTransform: 'uppercase' }}>
              {m.l}
            </div>
            <div style={{ fontSize: mobile && i === 2 ? 16 : 18, fontWeight: 900, letterSpacing: '-.02em', marginTop: 4, color: '#fff' }}>{m.v}</div>
            <div style={{ fontSize: 9.5, color: m.tone, marginTop: 2, fontWeight: 600 }}>↑ {m.d}</div>
          </div>
        ))}
      </div>

      <div
        style={{
          position: 'relative',
          background: 'rgba(255,255,255,.03)',
          border: '1px solid rgba(255,255,255,.06)',
          borderRadius: 12,
          padding: '12px 14px 6px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#fff', fontFamily: MONO, letterSpacing: '.1em', textTransform: 'uppercase' }}>
            Crescimento 12 semanas
          </div>
          <div style={{ fontSize: 10, color: BRAND.green, fontWeight: 700 }}>+42,3%</div>
        </div>
        <svg key={animKey} width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
          <defs>
            <linearGradient id="igGrad" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={BRAND.yellow} stopOpacity={0.35} />
              <stop offset="100%" stopColor={BRAND.yellow} stopOpacity={0} />
            </linearGradient>
          </defs>
          {[0, 1, 2, 3].map((g) => (
            <line
              key={g}
              x1={padL}
              x2={W - 16}
              y1={padB + g * ((H - padB - 10) / 3)}
              y2={padB + g * ((H - padB - 10) / 3)}
              stroke="rgba(255,255,255,.06)"
              strokeDasharray="2 3"
            />
          ))}
          <path d={area} fill="url(#igGrad)" />
          <path
            d={path}
            fill="none"
            stroke={BRAND.yellow}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="600"
            strokeDashoffset="600"
            style={{ animation: 'ig-stroke 1.4s cubic-bezier(.22,1,.36,1) forwards' }}
          />
          {followerPoints.map(([i, v]) => (
            <circle key={i} cx={xScale(i)} cy={yScale(v)} r="2" fill={BRAND.yellow} opacity={i === 11 ? 1 : 0.4} />
          ))}
          <circle cx={xScale(11)} cy={yScale(100)} r="5" fill="none" stroke={BRAND.yellow} strokeWidth="2" opacity={0.5}>
            <animate attributeName="r" values="4;10;4" dur="2s" repeatCount="indefinite" />
            <animate attributeName="opacity" values=".8;0;.8" dur="2s" repeatCount="indefinite" />
          </circle>
        </svg>
        <style>{`@keyframes ig-stroke{to{stroke-dashoffset:0}}`}</style>
      </div>

      <div
        style={{
          position: 'relative',
          marginTop: 12,
          display: 'flex',
          alignItems: mobile ? 'flex-start' : 'center',
          flexDirection: mobile ? 'column' : 'row',
          gap: mobile ? 8 : 12,
          padding: mobile ? '12px 14px' : '10px 12px',
          background: 'rgba(255,255,255,.04)',
          borderRadius: 12,
          border: '1px solid rgba(255,255,255,.06)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: mobile ? '100%' : undefined }}>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              background: 'linear-gradient(135deg,#f09433,#dc2743,#bc1888)',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
            }}
          >
            🥐
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#fff', marginBottom: 2 }}>Reels: "Como a gente monta o café"</div>
            <div style={{ fontSize: 10, color: '#9ca3af', fontFamily: MONO, letterSpacing: '.06em' }}>TOP POST DA SEMANA · 38,4K VIEWS</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, fontSize: 10, color: '#9ca3af', ...(mobile ? { paddingLeft: 48 } : {}) }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <Heart size={12} color={BRAND.red} fill={BRAND.red} />
            2,1k
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <MessageCircle size={12} color={BRAND.teal} fill={BRAND.teal} />
            184
          </span>
        </div>
      </div>
    </div>
  );
}

export function HubVisual() {
  const [pick, setPick] = useState(0);
  const mobile = useIsMobile();
  useEffect(() => {
    const id = setInterval(() => setPick((p) => (p + 1) % 3), 3200);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      style={{
        position: 'relative',
        borderRadius: 22,
        overflow: 'hidden',
        boxShadow: '0 30px 80px -20px rgba(0,0,0,.2)',
        background: '#FAFAF7',
        backgroundImage:
          'radial-gradient(900px 500px at 10% -10%,rgba(255,191,48,.1),transparent 60%),radial-gradient(700px 420px at 110% 10%,rgba(120,113,108,.08),transparent 60%)',
      }}
    >
      <div style={{ background: '#0a0a0a', padding: mobile ? '10px 14px' : '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <img src="/logo-white.svg" style={{ height: 14 }} alt="" />
          <span
            style={{
              padding: '2px 7px',
              borderRadius: 9999,
              background: BRAND.yellow,
              color: BRAND.dark,
              fontSize: 8,
              fontWeight: 700,
              letterSpacing: '.1em',
              textTransform: 'uppercase',
              fontFamily: MONO,
            }}
          >
            Hub
          </span>
        </div>
        <div style={{ display: 'flex', gap: mobile ? 1 : 3 }}>
          {(mobile ? ['Aprovar', 'Marca'] : ['Início', 'Aprovar', 'Marca', 'Mensagens']).map((t) => {
            const isActive = t === 'Aprovar';
            return (
              <span
                key={t}
                style={{
                  padding: mobile ? '5px 7px' : '5px 9px',
                  borderRadius: 7,
                  fontSize: mobile ? 10 : 10.5,
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? '#fff' : 'rgba(255,255,255,.55)',
                  position: 'relative',
                }}
              >
                {t}
                {isActive && (
                  <span
                    style={{
                      marginLeft: 5,
                      padding: '1px 5px',
                      borderRadius: 9999,
                      background: BRAND.yellow,
                      color: BRAND.dark,
                      fontSize: 8,
                      fontWeight: 700,
                    }}
                  >
                    3
                  </span>
                )}
                {isActive && <span style={{ position: 'absolute', left: 9, right: 9, bottom: 1, height: 1.5, background: BRAND.yellow, borderRadius: 2 }} />}
              </span>
            );
          })}
        </div>
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: 9999,
            background: 'linear-gradient(135deg,#FFBF30,#ca8a04)',
            color: '#12151a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            fontWeight: 700,
          }}
        >
          DL
        </div>
      </div>

      <div style={{ padding: '24px 24px 28px' }}>
        <div style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, color: '#78716c', letterSpacing: '.14em', textTransform: 'uppercase' }}>
          Agência Paralela
        </div>
        <div
          style={{
            fontFamily: "'Fraunces',serif",
            fontWeight: 500,
            fontSize: 30,
            letterSpacing: '-.012em',
            lineHeight: 1.02,
            color: '#1C1917',
            marginTop: 8,
          }}
        >
          Aprovar <em style={{ fontStyle: 'italic', fontWeight: 400, color: '#a16207' }}>posts</em>
        </div>
        <div style={{ fontFamily: "'Instrument Sans',sans-serif", fontSize: 13, color: '#57534e', marginTop: 6 }}>
          3 posts aguardando sua aprovação · 1 vence hoje
        </div>

        <div
          style={{
            marginTop: 18,
            background: '#fff',
            borderRadius: 16,
            border: '1px solid rgba(231,229,228,1)',
            overflow: 'hidden',
            boxShadow: '0 1px 0 rgba(0,0,0,.02),0 1px 2px rgba(28,25,23,.04)',
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '150px 1fr', gap: 0 }}>
            <div
              style={{
                aspectRatio: mobile ? '16/9' : '1/1',
                background: 'linear-gradient(145deg,#d4a574 0%,#c4956a 25%,#a67c52 50%,#8b6541 75%,#6d4c30 100%)',
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
              }}
            >
              <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 30% 40%, rgba(255,255,255,.18), transparent 60%)' }} />
              <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 70% 70%, rgba(0,0,0,.12), transparent 50%)' }} />
              <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <span style={{ fontSize: 32, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,.15))' }}>🍂</span>
                <span style={{ fontSize: 8, fontFamily: MONO, fontWeight: 700, color: 'rgba(255,255,255,.85)', letterSpacing: '.12em', textTransform: 'uppercase' }}>Inverno</span>
              </div>
              <div
                style={{
                  position: 'absolute',
                  top: 8,
                  left: 8,
                  padding: '3px 8px',
                  borderRadius: 6,
                  background: 'rgba(0,0,0,.6)',
                  color: '#fff',
                  fontSize: 9,
                  fontWeight: 700,
                  fontFamily: MONO,
                  letterSpacing: '.08em',
                }}
              >
                REELS
              </div>
            </div>
            <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span
                  style={{
                    padding: '2px 8px',
                    borderRadius: 9999,
                    background: 'rgba(245,163,66,.12)',
                    color: '#b47011',
                    fontSize: 9.5,
                    fontWeight: 600,
                    fontFamily: MONO,
                    letterSpacing: '.08em',
                    textTransform: 'uppercase',
                  }}
                >
                  Vence hoje · 18h
                </span>
              </div>
              <div style={{ fontFamily: "'Fraunces',serif", fontSize: 16, fontWeight: 500, letterSpacing: '-.01em', color: '#1C1917', lineHeight: 1.25 }}>
                Novo cardápio de inverno
              </div>
              <div style={{ fontFamily: "'Instrument Sans',sans-serif", fontSize: 12, color: '#57534e', marginTop: 6, lineHeight: 1.5, flex: 1 }}>
                "Chegou o inverno e com ele o cardápio mais aconchegante da temporada. Venha conhecer..."
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button
                  style={{
                    flex: 1,
                    padding: '9px 12px',
                    borderRadius: 9999,
                    background: pick === 1 ? BRAND.green : '#1C1917',
                    color: '#fff',
                    border: 'none',
                    fontFamily: "'Instrument Sans',sans-serif",
                    fontSize: 12,
                    fontWeight: 600,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 5,
                    transition: 'background .4s',
                    cursor: 'default',
                  }}
                >
                  {pick === 1 && <Check size={12} />}
                  {pick === 1 ? 'Aprovado!' : 'Aprovar post'}
                </button>
                <button
                  style={{
                    padding: '9px 12px',
                    borderRadius: 9999,
                    background: 'transparent',
                    color: '#57534e',
                    border: '1px solid rgba(231,229,228,1)',
                    fontFamily: "'Instrument Sans',sans-serif",
                    fontSize: 12,
                    fontWeight: 500,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    cursor: 'default',
                  }}
                >
                  <MessageCircle size={13} />
                  Pedir ajuste
                </button>
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 12, display: 'flex', flexDirection: mobile ? 'column' : 'row', gap: 10 }}>
          {[
            { t: 'Carrossel — dicas', g: 'linear-gradient(135deg,#bbf7d0,#86efac,#22c55e)', e: '🌿' },
            { t: 'Story promoção', g: 'linear-gradient(135deg,#fecaca,#fca5a5,#ef4444)', e: '🔥' },
          ].map((p, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                display: 'flex',
                gap: 10,
                alignItems: 'center',
                padding: '10px 12px',
                background: '#fff',
                borderRadius: 12,
                border: '1px solid rgba(231,229,228,1)',
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: p.g,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 18,
                  flexShrink: 0,
                }}
              >
                {p.e}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#1C1917', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {p.t}
                </div>
                <div style={{ fontSize: 9.5, color: '#78716c', marginTop: 1, fontFamily: MONO, letterSpacing: '.06em' }}>AGUARDANDO</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 14, fontSize: 10.5, color: '#78716c', fontFamily: "'Instrument Sans',sans-serif", textAlign: 'center' }}>
          <LinkIcon size={12} style={{ verticalAlign: 'middle', marginRight: 4, display: 'inline' }} />
          Portal acessado por link único — sem login necessário
        </div>
      </div>
    </div>
  );
}

export function CalendarVisual() {
  const mobile = useIsMobile();
  const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const offset = 4;
  const cells: (number | null)[] = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= 31; d++) cells.push(d);

  const events: Record<number, Array<{ t: string; c: string }>> = {
    2: [{ t: 'Reels', c: BRAND.yellow }],
    5: [{ t: 'Feed', c: BRAND.green }],
    7: [{ t: 'Story', c: BRAND.teal }],
    9: [{ t: 'Reels', c: BRAND.yellow }],
    12: [{ t: 'Carrossel', c: BRAND.pink }],
    13: [
      { t: 'Reels', c: BRAND.yellow },
      { t: 'Story', c: BRAND.teal },
    ],
    15: [{ t: 'Feed', c: BRAND.green }],
    16: [{ t: 'Carrossel', c: BRAND.pink }],
    19: [{ t: 'Reels', c: BRAND.yellow }],
    20: [{ t: 'Feed', c: BRAND.green }],
    22: [{ t: 'Story', c: BRAND.teal }],
    23: [{ t: 'Reels', c: BRAND.yellow }],
    26: [{ t: 'Carrossel', c: BRAND.pink }],
    27: [{ t: 'Reels', c: BRAND.yellow }],
    29: [{ t: 'Feed', c: BRAND.green }],
    30: [{ t: 'Story', c: BRAND.teal }],
  };
  const today = 13;

  const legend = [
    { l: 'Feed', c: BRAND.green },
    { l: 'Reels', c: BRAND.yellow },
    { l: 'Story', c: BRAND.teal },
    { l: 'Carrossel', c: BRAND.pink },
  ];

  const upcomingPosts = [
    { day: 13, weekday: 'Qui', items: [{ t: 'Reels', c: BRAND.yellow, title: 'Café da Manhã — Bastidores' }, { t: 'Story', c: BRAND.teal, title: 'Promoção relâmpago' }] },
    { day: 15, weekday: 'Sáb', items: [{ t: 'Feed', c: BRAND.green, title: 'Post Dia das Mães' }] },
    { day: 16, weekday: 'Dom', items: [{ t: 'Carrossel', c: BRAND.pink, title: 'Dicas de inverno' }] },
    { day: 19, weekday: 'Qua', items: [{ t: 'Reels', c: BRAND.yellow, title: 'Novo cardápio' }] },
    { day: 20, weekday: 'Qui', items: [{ t: 'Feed', c: BRAND.green, title: 'Cliente em destaque' }] },
  ];

  if (mobile) {
    return (
      <div style={{ background: '#fff', borderRadius: 20, padding: 16, border: '1px solid rgba(30,36,48,.06)', boxShadow: '0 30px 80px -20px rgba(0,0,0,.15)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div className="eyebrow-micro" style={{ fontSize: '.65rem' }}>Calendário editorial</div>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-.01em', color: BRAND.dark, marginTop: 4 }}>Maio 2025</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {legend.map((l) => (
              <div key={l.l} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: '#4b5563', fontFamily: MONO, letterSpacing: '.06em' }}>
                <span style={{ width: 6, height: 6, borderRadius: 9999, background: l.c }} />
                {l.l}
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 3, marginBottom: 14 }}>
          {days.map((d) => (
            <div key={d} style={{ fontSize: 8, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#9ca3af', fontFamily: MONO, textAlign: 'center', padding: '3px 0' }}>
              {d.charAt(0)}
            </div>
          ))}
          {cells.map((d, i) => {
            if (d === null) return <div key={i} />;
            const evs = events[d] || [];
            const isToday = d === today;
            return (
              <div
                key={i}
                style={{
                  aspectRatio: '1/1',
                  background: isToday ? 'rgba(255,191,48,.15)' : evs.length ? '#fafbfc' : 'transparent',
                  border: isToday ? `1.5px solid ${BRAND.yellow}` : evs.length ? '1px solid rgba(30,36,48,.06)' : 'none',
                  borderRadius: 6,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 2,
                }}
              >
                <div style={{ fontSize: 10, fontWeight: isToday ? 800 : 500, color: isToday ? '#a16207' : evs.length ? BRAND.dark : '#9ca3af' }}>{d}</div>
                {evs.length > 0 && (
                  <div style={{ display: 'flex', gap: 2 }}>
                    {evs.slice(0, 2).map((e, j) => (
                      <span key={j} style={{ width: 5, height: 5, borderRadius: 9999, background: e.c }} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: '#6b7280', marginBottom: 10 }}>
          Próximos posts
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {upcomingPosts.map((row) => (
            <div key={row.day} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 10px', background: row.day === today ? 'rgba(255,191,48,.08)' : '#fafbfc', borderRadius: 10, border: row.day === today ? `1px solid rgba(255,191,48,.2)` : '1px solid rgba(30,36,48,.06)' }}>
              <div style={{ textAlign: 'center', minWidth: 32 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: row.day === today ? '#a16207' : BRAND.dark, lineHeight: 1 }}>{row.day}</div>
                <div style={{ fontSize: 8, fontWeight: 600, color: '#9ca3af', fontFamily: MONO, letterSpacing: '.08em', marginTop: 2 }}>{row.weekday}</div>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {row.items.map((item, j) => (
                  <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 6, height: 6, borderRadius: 9999, background: item.c, flexShrink: 0 }} />
                    <span style={{ fontSize: 10, fontWeight: 600, color: '#4b5563', fontFamily: MONO, letterSpacing: '.06em', textTransform: 'uppercase' }}>{item.t}</span>
                    <span style={{ fontSize: 11, color: BRAND.dark, fontWeight: 500 }}>{item.title}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: '#fff', borderRadius: 20, padding: 20, border: '1px solid rgba(30,36,48,.06)', boxShadow: '0 30px 80px -20px rgba(0,0,0,.15)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <div className="eyebrow-micro" style={{ fontSize: '.65rem' }}>
            Calendário editorial
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-.01em', color: BRAND.dark, marginTop: 4 }}>Maio 2025</div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {legend.map((l) => (
            <div key={l.l} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#4b5563', fontFamily: MONO, letterSpacing: '.06em' }}>
              <span style={{ width: 7, height: 7, borderRadius: 9999, background: l.c }} />
              {l.l}
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4, marginBottom: 6 }}>
        {days.map((d) => (
          <div
            key={d}
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '.1em',
              textTransform: 'uppercase',
              color: '#9ca3af',
              fontFamily: MONO,
              textAlign: 'center',
              padding: '4px 0',
            }}
          >
            {d}
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4 }}>
        {cells.map((d, i) => {
          if (d === null) return <div key={i} style={{ aspectRatio: '1/1', background: 'transparent' }} />;
          const evs = events[d] || [];
          const isToday = d === today;
          return (
            <div
              key={i}
              style={{
                aspectRatio: '1/.85',
                background: isToday ? 'rgba(255,191,48,.12)' : '#fafbfc',
                border: isToday ? `1.5px solid ${BRAND.yellow}` : '1px solid rgba(30,36,48,.06)',
                borderRadius: 8,
                padding: '5px 6px',
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div style={{ fontSize: 10, fontWeight: isToday ? 800 : 600, color: isToday ? '#a16207' : BRAND.dark, letterSpacing: '-.01em' }}>{d}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                {evs.slice(0, 2).map((e, j) => (
                  <div
                    key={j}
                    style={{
                      fontSize: 8,
                      fontWeight: 600,
                      color: '#fff',
                      background: e.c,
                      borderRadius: 3,
                      padding: '1px 4px',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      lineHeight: 1.3,
                    }}
                  >
                    {e.t}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function FinanceVisual() {
  const mobile = useIsMobile();
  const kpis = [
    { l: 'Receita prevista', v: 'R$ 12.480', c: BRAND.green, d: 'R$ 2.400 em aberto' },
    { l: 'Despesas', v: 'R$ 920', c: BRAND.red, d: '12% abaixo da média' },
    { l: 'Resultado', v: 'R$ 11.560', c: BRAND.yellow, d: 'Best mês de 2025' },
  ];
  const transactions = [
    { d: '02/05', c: 'Café da Manhã', desc: 'Mensalidade Maio', v: 2400, st: 'Pago' as const },
    { d: '02/05', c: 'Studio Vilma', desc: 'Mensalidade Maio', v: 1800, st: 'Pago' as const },
    { d: '01/05', c: 'Adobe CC', desc: 'Assinatura', v: -320, st: 'Pago' as const },
    { d: '30/04', c: 'Bella Moda', desc: 'Mensalidade', v: 2400, st: 'Aguardando' as const },
  ];

  return (
    <div style={{ background: '#fff', borderRadius: 20, padding: mobile ? 16 : 22, border: '1px solid rgba(30,36,48,.06)', boxShadow: '0 30px 80px -20px rgba(0,0,0,.15)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div className="eyebrow-micro" style={{ fontSize: '.65rem' }}>
            Financeiro · Maio
          </div>
          <div style={{ fontSize: mobile ? 18 : 20, fontWeight: 800, letterSpacing: '-.01em', color: BRAND.dark, marginTop: 4 }}>Fluxo de caixa</div>
        </div>
        <span
          style={{
            padding: '5px 10px',
            borderRadius: 8,
            background: 'rgba(62,207,142,.14)',
            color: '#1e9e66',
            fontSize: 10,
            fontWeight: 700,
            fontFamily: MONO,
            letterSpacing: '.08em',
          }}
        >
          ↑ MARGEM 92,6%
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : 'repeat(3,1fr)', gap: 8, marginBottom: 16 }}>
        {kpis.map((k, i) => (
          <div
            key={i}
            style={{
              padding: mobile ? '12px 14px' : '10px 12px',
              borderRadius: 10,
              background: '#fafbfc',
              border: '1px solid rgba(30,36,48,.06)',
              borderLeft: `3px solid ${k.c}`,
              ...(mobile ? { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } : {}),
            }}
          >
            <div>
              <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '.12em', textTransform: 'uppercase', color: '#6b7280', fontWeight: 700 }}>{k.l}</div>
              {!mobile && <div style={{ fontSize: 9, color: '#6b7280', marginTop: 4 }}>{k.d}</div>}
            </div>
            <div style={{ fontSize: mobile ? 18 : 15, fontWeight: 800, letterSpacing: '-.01em', color: BRAND.dark, marginTop: mobile ? 0 : 4, fontFamily: MONO }}>{k.v}</div>
          </div>
        ))}
      </div>

      <div style={{ borderRadius: 10, border: '1px solid rgba(30,36,48,.06)', overflow: 'hidden' }}>
        {mobile ? (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {transactions.map((t, i) => (
              <div
                key={i}
                style={{
                  padding: '12px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderTop: i > 0 ? '1px solid rgba(30,36,48,.05)' : 'none',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontWeight: 600, color: BRAND.dark, fontSize: 12 }}>{t.c}</span>
                    <Badge tone={t.st === 'Pago' ? 'success' : 'warning'} small>{t.st}</Badge>
                  </div>
                  <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2, fontFamily: MONO }}>{t.d} · {t.desc}</div>
                </div>
                <span
                  style={{
                    fontFamily: MONO,
                    fontWeight: 700,
                    color: t.v > 0 ? BRAND.dark : BRAND.red,
                    fontSize: 13,
                    flexShrink: 0,
                    marginLeft: 12,
                  }}
                >
                  {t.v > 0 ? '' : '−'}R$ {Math.abs(t.v).toLocaleString('pt-BR')}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <>
            <div
              style={{
                padding: '8px 12px',
                background: '#fafbfc',
                display: 'grid',
                gridTemplateColumns: '52px 1fr 72px 70px',
                gap: 10,
                fontFamily: MONO,
                fontSize: 8.5,
                fontWeight: 700,
                letterSpacing: '.1em',
                textTransform: 'uppercase',
                color: '#6b7280',
              }}
            >
              <span>Data</span>
              <span>Cliente</span>
              <span style={{ textAlign: 'right' }}>Valor</span>
              <span>Status</span>
            </div>
            {transactions.map((t, i) => (
              <div
                key={i}
                style={{
                  padding: '10px 12px',
                  display: 'grid',
                  gridTemplateColumns: '52px 1fr 72px 70px',
                  gap: 10,
                  alignItems: 'center',
                  borderTop: '1px solid rgba(30,36,48,.05)',
                  fontSize: 11,
                }}
              >
                <span style={{ fontFamily: MONO, color: '#6b7280' }}>{t.d}</span>
                <div>
                  <div style={{ fontWeight: 600, color: BRAND.dark }}>{t.c}</div>
                  <div style={{ fontSize: 9.5, color: '#9ca3af', marginTop: 1 }}>{t.desc}</div>
                </div>
                <span
                  style={{
                    textAlign: 'right',
                    fontFamily: MONO,
                    fontWeight: 700,
                    color: t.v > 0 ? BRAND.dark : BRAND.red,
                    fontSize: 11,
                  }}
                >
                  {t.v > 0 ? '' : '−'}R$ {Math.abs(t.v).toLocaleString('pt-BR')}
                </span>
                <Badge tone={t.st === 'Pago' ? 'success' : 'warning'} small>{t.st}</Badge>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

export function SchedulingVisual() {
  const mobile = useIsMobile();
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setPhase((p) => (p + 1) % 3), 3200);
    return () => clearInterval(id);
  }, []);

  const steps = [
    { label: 'Aprovado', color: BRAND.yellow },
    { label: 'Agendado', color: BRAND.blue },
    { label: 'Publicado', color: BRAND.green },
  ];

  return (
    <div
      style={{
        background: BRAND.dark,
        borderRadius: 22,
        padding: mobile ? 16 : 22,
        color: '#fff',
        boxShadow: '0 30px 80px -20px rgba(0,0,0,.3)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: -60,
          right: -60,
          width: 220,
          height: 220,
          borderRadius: 9999,
          background: 'radial-gradient(closest-side,rgba(57,132,255,.25),transparent)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: -80,
          left: -40,
          width: 240,
          height: 240,
          borderRadius: 9999,
          background: 'radial-gradient(closest-side,rgba(62,207,142,.15),transparent)',
          pointerEvents: 'none',
        }}
      />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, position: 'relative' }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: 'linear-gradient(135deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Instagram size={16} color="#fff" />
        </div>
        <div>
          <div style={{ fontSize: '.82rem', fontWeight: 600, lineHeight: 1.2 }}>@bella.moda</div>
          <div style={{ fontSize: '.6rem', color: 'rgba(255,255,255,.45)', fontFamily: MONO, letterSpacing: '.06em' }}>CONTA CONECTADA</div>
        </div>
        <Badge tone="success" small>
          <Send size={9} style={{ marginRight: 2 }} /> PUBLICAÇÃO AUTO
        </Badge>
      </div>

      {/* Post card */}
      <div
        style={{
          background: 'rgba(255,255,255,.06)',
          borderRadius: 14,
          padding: mobile ? 12 : 16,
          border: '1px solid rgba(255,255,255,.08)',
          marginBottom: 14,
          position: 'relative',
        }}
      >
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div
            style={{
              width: mobile ? 56 : 68,
              height: mobile ? 56 : 68,
              borderRadius: 10,
              background: 'linear-gradient(135deg,#e8d5b7,#d4a574)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: mobile ? 22 : 28,
              flexShrink: 0,
            }}
          >
            👗
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <Badge tone="teal" small>CARROSSEL</Badge>
              <span style={{ fontSize: '.6rem', color: 'rgba(255,255,255,.35)', fontFamily: MONO }}>3 MÍDIAS</span>
            </div>
            <div style={{ fontSize: '.85rem', fontWeight: 600, marginBottom: 3, lineHeight: 1.3 }}>
              Lançamento Coleção Inverno
            </div>
            <div
              style={{
                fontSize: '.72rem',
                color: 'rgba(255,255,255,.5)',
                lineHeight: 1.4,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              As peças mais quentes da temporada estão aqui. Confira...
            </div>
          </div>
        </div>
      </div>

      {/* Action row — phase-dependent */}
      <div
        style={{
          background: 'rgba(255,255,255,.04)',
          borderRadius: 12,
          padding: mobile ? '10px 12px' : '12px 16px',
          border: '1px solid rgba(255,255,255,.06)',
          marginBottom: 16,
          transition: 'all .4s ease',
          position: 'relative',
        }}
      >
        {phase === 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <CalendarClock size={15} color={BRAND.yellow} />
              <span style={{ fontFamily: MONO, fontSize: '.75rem', fontWeight: 600, letterSpacing: '.04em' }}>
                15 Mai · 14:00
              </span>
            </div>
            <div
              style={{
                padding: '6px 14px',
                borderRadius: 8,
                background: BRAND.blue,
                color: '#fff',
                fontSize: '.72rem',
                fontWeight: 700,
                fontFamily: MONO,
                letterSpacing: '.04em',
                animation: 'sched-pulse 2s infinite',
                cursor: 'default',
                whiteSpace: 'nowrap',
              }}
            >
              <Send size={11} style={{ marginRight: 4, verticalAlign: '-1px' }} />
              AGENDAR
            </div>
          </div>
        )}
        {phase === 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Clock size={15} color={BRAND.teal} />
              <div>
                <div style={{ fontFamily: MONO, fontSize: '.75rem', fontWeight: 600, letterSpacing: '.04em' }}>
                  15 Mai · 14:00
                </div>
                <div style={{ fontFamily: MONO, fontSize: '.58rem', color: BRAND.teal, letterSpacing: '.08em', marginTop: 2 }}>
                  PUBLICA EM 2 DIAS
                </div>
              </div>
            </div>
            <Badge tone="success">
              <Check size={10} style={{ marginRight: 2 }} /> AGENDADO
            </Badge>
          </div>
        )}
        {phase === 2 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <CheckCircle2 size={15} color={BRAND.green} />
              <div>
                <div style={{ fontFamily: MONO, fontSize: '.75rem', fontWeight: 600, letterSpacing: '.04em', color: BRAND.green }}>
                  PUBLICADO
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 2 }}>
                  <ExternalLink size={9} color="rgba(255,255,255,.4)" />
                  <span style={{ fontFamily: MONO, fontSize: '.55rem', color: 'rgba(255,255,255,.4)', letterSpacing: '.04em' }}>
                    instagram.com/p/Cx7k...
                  </span>
                </div>
              </div>
            </div>
            <Badge tone="success">
              <CheckCircle2 size={10} style={{ marginRight: 2 }} /> NO AR
            </Badge>
          </div>
        )}
      </div>

      {/* Timeline */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0, position: 'relative' }}>
        {steps.map((s, i) => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div
                style={{
                  width: i <= phase ? 10 : 8,
                  height: i <= phase ? 10 : 8,
                  borderRadius: 9999,
                  background: i <= phase ? s.color : 'rgba(255,255,255,.15)',
                  transition: 'all .4s ease',
                  boxShadow: i === phase ? `0 0 8px ${s.color}60` : 'none',
                }}
              />
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: '.52rem',
                  fontWeight: i <= phase ? 700 : 500,
                  letterSpacing: '.08em',
                  color: i <= phase ? s.color : 'rgba(255,255,255,.25)',
                  transition: 'all .4s ease',
                  textTransform: 'uppercase',
                }}
              >
                {s.label}
              </span>
            </div>
            {i < 2 && (
              <div
                style={{
                  width: mobile ? 36 : 56,
                  height: 2,
                  background: i < phase ? steps[i + 1].color : 'rgba(255,255,255,.1)',
                  borderRadius: 1,
                  margin: '0 8px',
                  marginBottom: 16,
                  transition: 'background .4s ease',
                }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function IconSquare({ icon, color = BRAND.yellow }: { icon: React.ReactNode; color?: string }) {
  return (
    <div
      style={{
        width: 44,
        height: 44,
        borderRadius: 12,
        background: `linear-gradient(135deg,${color},${shade(color, -15)})`,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: contrastFor(color),
        boxShadow: `0 6px 18px -6px ${color}80`,
      }}
    >
      {icon}
    </div>
  );
}

export { ArrowRight, Calendar, CircleDollarSign, Instagram, LayoutGrid, Send, Users };
