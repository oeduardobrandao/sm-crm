import { useNavigate, useParams } from 'react-router-dom';
import {
  Palette,
  FileText,
  BookOpen,
  Lightbulb,
  ChevronRight,
  CheckSquare,
  ArrowRight,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useHub } from '../HubContext';
import { fetchPosts } from '../api';
import { PostCalendar } from '../components/PostCalendar';
import { DashboardSection } from '../components/dashboard/DashboardSection';

const RESOURCE_LINKS = [
  { label: 'Marca', icon: Palette, path: '/marca' },
  { label: 'Páginas', icon: FileText, path: '/paginas' },
  { label: 'Briefing', icon: BookOpen, path: '/briefing' },
  { label: 'Ideias', icon: Lightbulb, path: '/ideias' },
];

const CALENDAR_STATUSES = new Set([
  'enviado_cliente',
  'aprovado_cliente',
  'correcao_cliente',
  'agendado',
  'postado',
]);

function formatNextPost(scheduledAt: string): string {
  const date = new Date(scheduledAt);
  const weekday = date.toLocaleDateString('pt-BR', { weekday: 'short' });
  const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${weekday.replace('.', '')} ${time}`;
}

export function HomePage() {
  const { bootstrap, token } = useHub();
  const { workspace } = useParams<{ workspace: string }>();
  const navigate = useNavigate();
  const base = `/${workspace}/hub/${token}`;

  const { data, isLoading } = useQuery({
    queryKey: ['hub-posts', token],
    queryFn: () => fetchPosts(token),
  });

  const allPosts = data?.posts ?? [];
  const pendingCount = allPosts.filter((p) => p.status === 'enviado_cliente').length;
  const posts = allPosts.filter((p) => CALENDAR_STATUSES.has(p.status));

  const now = new Date();
  const thisMonthCount = allPosts.filter((p) => {
    if (!p.scheduled_at) return false;
    const d = new Date(p.scheduled_at);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;

  const decided = allPosts.filter(
    (p) => p.status === 'aprovado_cliente' || p.status === 'correcao_cliente',
  );
  const approvalRate =
    decided.length === 0
      ? '—'
      : `${Math.round((decided.filter((p) => p.status === 'aprovado_cliente').length / decided.length) * 100)}%`;

  const upcoming = allPosts
    .filter((p) => p.scheduled_at && new Date(p.scheduled_at) >= now)
    .sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? ''));
  const nextPost = upcoming[0];

  const firstName = bootstrap.cliente_nome.split(' ')[0];

  const kpis = [
    { label: 'Posts este mês', value: String(thisMonthCount), hint: 'Feed, Reels, Stories' },
    {
      label: 'Aprovações pendentes',
      value: String(pendingCount),
      hint: pendingCount ? `${pendingCount} para revisar` : 'Tudo em dia',
      onClick: () => navigate(`${base}/aprovacoes`),
    },
    { label: 'Taxa de aprovação', value: approvalRate, hint: 'Aprovados vs. correção' },
    {
      label: 'Próximo post',
      value: nextPost ? formatNextPost(nextPost.scheduled_at!) : '—',
      hint: nextPost?.titulo ?? 'Nada agendado',
    },
  ];

  return (
    <div className="hub-fade-up flex flex-col gap-6">
      <section>
        <p className="text-[13px] font-medium hub-tx3 mb-1.5">{bootstrap.workspace.name}</p>
        <h1 className="font-display font-medium text-[clamp(2rem,5vw,3rem)] leading-[1.04] tracking-tight hub-txt mb-1.5">
          Olá, <em className="italic font-normal">{firstName}</em> 👋
        </h1>
      </section>

      <section
        className="grid gap-3"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}
      >
        {kpis.map((k) => {
          const content = (
            <>
              <div>
                <div className="text-[15px] font-semibold tracking-tight hub-txt">{k.label}</div>
                <div className="text-[12.5px] hub-tx3 mt-0.5">{k.hint}</div>
              </div>
              <div className="font-display text-[2.1rem] font-medium tracking-tight leading-none hub-txt mt-3.5">
                {k.value}
              </div>
            </>
          );
          return k.onClick ? (
            <button
              key={k.label}
              type="button"
              onClick={k.onClick}
              className="hub-card hub-card-hover cursor-pointer p-4 text-left w-full flex flex-col justify-between"
            >
              {content}
            </button>
          ) : (
            <div key={k.label} className="hub-card p-4 flex flex-col justify-between">
              {content}
            </div>
          );
        })}
      </section>

      {pendingCount > 0 && (
        <button
          type="button"
          onClick={() => navigate(`${base}/aprovacoes`)}
          className="hub-fade-up w-full flex items-center gap-3 px-5 py-3.5 rounded-2xl text-left group transition-shadow hover:shadow-sm"
          style={{
            background: 'color-mix(in srgb, var(--hub-txt) 5%, transparent)',
            border: '1px solid color-mix(in srgb, var(--hub-txt) 14%, transparent)',
          }}
        >
          <span
            className="flex items-center justify-center w-8 h-8 rounded-full flex-shrink-0"
            style={{
              background: 'color-mix(in srgb, var(--hub-txt) 10%, transparent)',
              color: 'var(--hub-txt)',
            }}
          >
            <CheckSquare size={16} strokeWidth={2} />
          </span>
          <span className="flex-1 text-sm font-medium hub-txt">
            {pendingCount === 1
              ? 'Você tem 1 post aguardando aprovação'
              : `Você tem ${pendingCount} posts aguardando aprovação`}
          </span>
          <ArrowRight
            size={16}
            className="hub-tx3 group-hover:translate-x-0.5 transition-transform flex-shrink-0"
          />
        </button>
      )}

      <section className="hub-card p-5">
        <h3 className="font-semibold text-[16px] tracking-tight hub-txt">Calendário</h3>
        <div className="text-[12.5px] hub-tx3 mt-0.5 mb-2.5">Próximas publicações</div>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin h-5 w-5 rounded-full border-2 border-stone-300 border-t-stone-900" />
          </div>
        ) : (
          <PostCalendar posts={posts} />
        )}
      </section>

      <section className="hub-card p-5">
        <h3 className="font-semibold text-[16px] tracking-tight hub-txt">Recursos</h3>
        <div className="text-[12.5px] hub-tx3 mt-0.5 mb-2.5">Acesso rápido</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {RESOURCE_LINKS.map(({ label, icon: Icon, path }) => (
            <button
              key={path}
              onClick={() => navigate(`${base}${path}`)}
              className="flex flex-col items-start gap-2.5 p-3.5 rounded-xl border hub-border text-left hover:border-[var(--hub-bd2)] hover:shadow-sm transition-all group"
            >
              <span className="w-8 h-8 rounded-lg hub-bg-soft flex items-center justify-center hub-tx2 flex-shrink-0">
                <Icon size={16} strokeWidth={1.75} />
              </span>
              <span className="flex items-center gap-1 text-[14px] font-medium hub-txt">
                {label}
                <ChevronRight
                  size={14}
                  className="hub-tx3 group-hover:translate-x-0.5 transition-transform"
                />
              </span>
            </button>
          ))}
        </div>
      </section>

      <DashboardSection />
    </div>
  );
}
