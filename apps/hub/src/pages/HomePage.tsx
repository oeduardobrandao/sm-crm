import { useNavigate, useParams } from 'react-router-dom';
import { CheckSquare, Palette, FileText, BookOpen, Lightbulb } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useHub } from '../HubContext';
import { fetchPosts } from '../api';
import { PostCalendar } from '../components/PostCalendar';

const SECTIONS = [
  { label: 'Aprovações', icon: CheckSquare, path: '/aprovacoes', description: 'Posts aguardando sua aprovação' },
  { label: 'Marca', icon: Palette, path: '/marca', description: 'Identidade visual e arquivos' },
  { label: 'Páginas', icon: FileText, path: '/paginas', description: 'Materiais e estratégia' },
  { label: 'Briefing', icon: BookOpen, path: '/briefing', description: 'Informações do seu projeto' },
  { label: 'Ideias', icon: Lightbulb, path: '/ideias', description: 'Compartilhe ideias com sua agência' },
];

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
  const pendingCount = allPosts.filter(p => p.status === 'enviado_cliente').length;

  const CALENDAR_STATUSES = new Set(['enviado_cliente', 'aprovado_cliente', 'correcao_cliente', 'agendado', 'publicado']);
  const posts = allPosts.filter(p => CALENDAR_STATUSES.has(p.status));

  const firstName = bootstrap.cliente_nome.split(' ')[0];

  return (
    <div className="hub-fade-up">
      {/* Hero */}
      <div className="mb-10 sm:mb-12">
        <p className="text-[11px] uppercase tracking-[0.14em] text-stone-500 font-medium mb-2">
          {bootstrap.workspace.name}
        </p>
        <h1 className="font-display text-[2.25rem] sm:text-[2.75rem] leading-[1.05] font-medium tracking-tight text-stone-900">
          Olá, <span className="italic font-normal">{firstName}</span>
          <span className="ml-2 inline-block">👋</span>
        </h1>
      </div>

      {/* Section cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-12">
        {SECTIONS.map(({ label, icon: Icon, path, description }, idx) => {
          const isPendente = path === '/aprovacoes' && pendingCount > 0;
          return (
            <button
              key={path}
              onClick={() => navigate(`${base}${path}`)}
              style={{ animationDelay: `${idx * 60}ms` }}
              className="hub-card hub-card-hover hub-fade-up relative flex flex-col items-start text-left p-5 sm:p-6 gap-4 group"
            >
              {isPendente && (
                <span className="absolute top-3 right-3 flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full bg-stone-900 text-white text-[11px] font-semibold leading-none">
                  {pendingCount}
                </span>
              )}
              <span className="flex items-center justify-center w-11 h-11 rounded-xl bg-stone-100 text-stone-700 group-hover:bg-[#FFBF30]/20 group-hover:text-stone-900 transition-colors">
                <Icon size={20} strokeWidth={1.75} />
              </span>
              <div className="space-y-1">
                <span className="block font-display text-[17px] font-semibold tracking-tight text-stone-900 leading-tight">
                  {label}
                </span>
                <span className="block text-[12.5px] text-stone-500 leading-snug">
                  {description}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin h-6 w-6 rounded-full border-2 border-stone-300 border-t-stone-900" />
        </div>
      ) : (
        <PostCalendar posts={posts} />
      )}
    </div>
  );
}
