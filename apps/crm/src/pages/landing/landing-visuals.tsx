import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Calendar,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronRight,
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
  Sparkles,
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
  return (
    '#' +
    ((1 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)).toString(16).slice(1)
  );
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
        border: '2px solid transparent',
        boxSizing: 'border-box',
      }}
    >
      {initials}
    </div>
  );
}

function Badge({
  children,
  tone = 'neutral',
  small,
}: {
  children: React.ReactNode;
  tone?: string;
  small?: boolean;
}) {
  const palette: Record<string, { bg: string; fg: string }> = {
    neutral: { bg: '#f1f5f9', fg: '#374151' },
    success: { bg: 'rgba(62,207,142,.15)', fg: '#15803d' },
    warning: { bg: 'rgba(245,163,66,.15)', fg: '#92590b' },
    danger: { bg: 'rgba(245,90,66,.12)', fg: '#c23b22' },
    yellow: { bg: 'rgba(255,191,48,.18)', fg: '#8a5a06' },
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
        fontFamily: "-apple-system,'SF Pro Display','Plus Jakarta Sans',system-ui,sans-serif",
        fontSize: small ? '.55rem' : '.66rem',
        fontWeight: 600,
        letterSpacing: '.08em',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

const MONO = "-apple-system,'SF Pro Display','Plus Jakarta Sans',system-ui,sans-serif";

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

/** Hero visual: real product screenshots composited into Apple's official
 * product bezels (MacBook Pro 14" Space Black + iPhone 16 Pro Black Titanium,
 * from developer.apple.com Design Resources), telling the two-sided story —
 * the agency runs the operation, the client approves from the phone.
 * Screenshots are captured by e2e/screenshots/landing-hero.spec.ts and the
 * composites live in public/landing/. */
export function HeroDevices() {
  return (
    <div className="hd-stage">
      <svg className="hd-grid" aria-hidden="true">
        <defs>
          <pattern id="hd-grid-pat" width="28" height="28" patternUnits="userSpaceOnUse">
            <path d="M 28 0 L 0 0 0 28" fill="none" stroke="rgba(30,36,48,.06)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#hd-grid-pat)" />
      </svg>

      <div className="hd-macbook">
        <span className="hd-tag hd-tag-agency">Sua agência</span>
        <img
          className="hd-light"
          src="/landing/hero-macbook.webp"
          width={1800}
          height={1087}
          alt="MacBook com o quadro de entregas do Mesaas: fluxos por etapa, do briefing à aprovação do cliente"
          loading="eager"
          fetchPriority="high"
          decoding="async"
        />
        <img
          className="hd-dark"
          src="/landing/hero-macbook-dark.webp"
          width={1800}
          height={1087}
          alt="MacBook com o quadro de entregas do Mesaas: fluxos por etapa, do briefing à aprovação do cliente"
          loading="lazy"
          decoding="async"
        />
      </div>

      <div className="hd-iphone">
        <span className="hd-tag hd-tag-client">Seu cliente</span>
        <img
          className="hd-light"
          src="/landing/hero-iphone.webp"
          width={560}
          height={1160}
          alt="iPhone com o Hub do cliente: aprovações pendentes e próximo post"
          loading="eager"
          decoding="async"
        />
        <img
          className="hd-dark"
          src="/landing/hero-iphone-dark.webp"
          width={560}
          height={1160}
          alt="iPhone com o Hub do cliente: aprovações pendentes e próximo post"
          loading="lazy"
          decoding="async"
        />
      </div>

      <div className="hd-toast" aria-hidden="true">
        <span className="hd-toast-check">
          <CheckCircle2 size={22} color={BRAND.green} fill={BRAND.green} strokeWidth={0} />
        </span>
        <span className="hd-toast-body">
          <span className="hd-toast-title">Post aprovado</span>
          <span className="hd-toast-text">
            Café da Manhã aprovou <strong>Novo cardápio</strong>
          </span>
          <span className="hd-toast-time">Agora mesmo</span>
        </span>
      </div>
    </div>
  );
}

/**
 * Decorative "content agent" composition for the landing MCP section: a sharp white
 * agent card centered over a blurred, out-of-focus backdrop of content fragments.
 * Mirrors the login page showcase. Purely visual — no interactivity.
 */
export function AgentVisual() {
  const frag = (extra: React.CSSProperties): React.CSSProperties => ({
    position: 'absolute',
    background: '#1a1e26',
    border: '1px solid #2a2f3a',
    borderRadius: 14,
    padding: 10,
    ...extra,
  });
  const line = (w?: string): React.CSSProperties => ({
    display: 'block',
    height: 6,
    borderRadius: 3,
    background: '#2a2f3a',
    width: w,
    marginBottom: w ? 0 : 6,
  });
  const chip: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    padding: '9px 11px',
    fontSize: 13,
    color: BRAND.dark,
  };
  return (
    <div style={{ position: 'relative', width: '100%', minHeight: 360, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, filter: 'blur(2px)', opacity: 0.55 }}>
        <div style={frag({ top: 26, left: 16, width: 150 })}>
          <div
            style={{
              height: 70,
              borderRadius: 10,
              marginBottom: 10,
              background: `linear-gradient(135deg,${BRAND.blue},${BRAND.teal})`,
            }}
          />
          <span style={line()} />
          <span style={line('55%')} />
        </div>
        <div style={frag({ top: 46, right: 12, width: 168 })}>
          <span style={line('50%')} />
          <div
            style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 46, marginTop: 10 }}
          >
            {[50, 75, 45, 90, 65].map((h, i) => (
              <span
                key={i}
                style={{ flex: 1, height: `${h}%`, background: '#3a4150', borderRadius: 3 }}
              />
            ))}
          </div>
        </div>
        <div style={frag({ bottom: 34, left: 0, width: 150 })}>
          <span style={line('50%')} />
          <div style={{ display: 'flex', gap: 7, marginTop: 10 }}>
            {[BRAND.blue, BRAND.yellow, BRAND.green, BRAND.pink].map((c) => (
              <span key={c} style={{ width: 22, height: 22, borderRadius: '50%', background: c }} />
            ))}
          </div>
        </div>
        <div style={frag({ bottom: 18, right: 24, width: 150 })}>
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: '50%',
              marginBottom: 8,
              background: `linear-gradient(135deg,${BRAND.yellow},${BRAND.green})`,
            }}
          />
          <span style={line()} />
          <span style={line('55%')} />
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%,-50%)',
          width: 300,
          maxWidth: '88%',
          background: '#fff',
          borderRadius: 18,
          padding: 16,
          boxShadow: '0 24px 60px rgba(0,0,0,.55)',
        }}
      >
        <p style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 600, color: BRAND.dark }}>
          No que vamos trabalhar hoje?
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {['Criar carrossel', 'Roteiro de Reels'].map((opt) => (
            <div key={opt} style={chip}>
              <span>{opt}</span>
              <ChevronRight size={15} color="#cbd5e1" />
            </div>
          ))}
          <div
            style={{
              ...chip,
              justifyContent: 'flex-start',
              gap: 8,
              border: `1px solid ${BRAND.yellow}`,
              color: '#94a3b8',
            }}
          >
            <Sparkles size={14} color={BRAND.yellow} />
            <span>Peça ao agente…</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function IconSquare({
  icon,
  color = BRAND.yellow,
}: {
  icon: React.ReactNode;
  color?: string;
}) {
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

/** Real product screenshot in a minimal browser frame — the standard visual
 * for the features section. Assets are captured and anonymized by
 * e2e/screenshots/landing-features.spec.ts into public/landing/. */
export function FeatureShot({
  src,
  srcDark,
  alt,
  url,
  width = 1400,
  height = 910,
}: {
  src: string;
  /** Dark-theme variant, shown when [data-theme='dark'] via the hd-light/hd-dark pair. */
  srcDark: string;
  alt: string;
  url: string;
  width?: number;
  height?: number;
}) {
  return (
    <div className="feat-shot">
      <div className="feat-shot-bar" aria-hidden="true">
        <span className="feat-shot-dot" style={{ background: '#ff6058' }} />
        <span className="feat-shot-dot" style={{ background: '#ffbd2e' }} />
        <span className="feat-shot-dot" style={{ background: '#27c941' }} />
        <span className="feat-shot-url">{url}</span>
      </div>
      <img
        className="hd-light"
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading="lazy"
        decoding="async"
      />
      <img
        className="hd-dark"
        src={srcDark}
        alt={alt}
        width={width}
        height={height}
        loading="lazy"
        decoding="async"
      />
    </div>
  );
}

/** Comment-to-DM automation visual: the one feature whose result lives inside
 * Instagram, so it is drawn (in the landing's own style) instead of using a
 * screenshot — keyword comment, automatic public reply, DM with a card. */
export function AutomacaoVisual() {
  return (
    <div className="av-stack">
      <div className="av-card">
        <div className="av-head">
          <span className="av-micro">Comentário no Reels</span>
          <span className="av-tag av-tag--neutral">Gatilho: QUERO</span>
        </div>
        <div className="av-row">
          <Avatar name="Mariana Souza" size={30} bg={BRAND.teal} />
          <div style={{ flex: 1 }}>
            <div className="av-comment">
              <strong>mariana.souza</strong> QUERO 🙋‍♀️
            </div>
            <div className="av-reply">
              <strong>cafedamanha</strong> Te chamei no direct, confere lá 💛
            </div>
            <div className="av-reply-tags" aria-hidden="true">
              <span className="av-tag av-tag--success">Resposta automática</span>
            </div>
          </div>
        </div>
      </div>

      <div className="av-arrow" aria-hidden="true">
        <ArrowRight size={18} style={{ transform: 'rotate(90deg)' }} />
      </div>

      <div className="av-card" style={{ animation: 'float-up 5s ease-in-out .6s infinite' }}>
        <div className="av-head">
          <span className="av-micro">Direct</span>
          <span className="av-tag av-tag--yellow">DM enviada</span>
        </div>
        <div className="av-dm">
          <div className="av-dm-img">
            <MessageCircle size={26} />
          </div>
          <div className="av-dm-body">
            <div className="av-dm-title">Guia do cardápio de inverno</div>
            <div className="av-dm-sub">Baixe grátis e escolha o seu favorito.</div>
            <div className="av-dm-btn">Baixar o guia</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export { ArrowRight, Calendar, Instagram, LayoutGrid, MessageCircle, Send, Users };
