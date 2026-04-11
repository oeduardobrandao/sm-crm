import { useNavigate, useParams } from 'react-router-dom';
import { CheckSquare, Palette, FileText, BookOpen } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useHub } from '../HubContext';
import { fetchPosts } from '../api';
import { PostCalendar } from '../components/PostCalendar';

const SECTIONS = [
  { label: 'Aprovações', icon: CheckSquare, path: '/aprovacoes', description: 'Posts aguardando sua aprovação' },
  { label: 'Marca', icon: Palette, path: '/marca', description: 'Identidade visual e arquivos' },
  { label: 'Páginas', icon: FileText, path: '/paginas', description: 'Materiais e estratégia' },
  { label: 'Briefing', icon: BookOpen, path: '/briefing', description: 'Informações do seu projeto' },
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

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <p className="text-sm text-muted-foreground mb-1">{bootstrap.workspace.name}</p>
        <h1 className="text-2xl font-semibold">Olá, {bootstrap.cliente_nome.split(' ')[0]} 👋</h1>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {SECTIONS.map(({ label, icon: Icon, path, description }) => {
          const isPendente = path === '/aprovacoes' && pendingCount > 0;
          return (
            <button
              key={path}
              onClick={() => navigate(`${base}${path}`)}
              className="relative flex flex-col items-center text-center p-5 rounded-xl border bg-white hover:bg-accent transition-colors gap-2"
            >
              {isPendente && (
                <span className="absolute top-2 right-2 bg-destructive text-destructive-foreground text-xs rounded-full px-1.5 py-0.5 font-medium">
                  {pendingCount}
                </span>
              )}
              <Icon size={24} className="text-muted-foreground" />
              <span className="font-medium text-sm">{label}</span>
              <span className="text-xs text-muted-foreground">{description}</span>
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12 mt-8">
          <div className="animate-spin h-6 w-6 rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : (
        <PostCalendar posts={posts} />
      )}
    </div>
  );
}
