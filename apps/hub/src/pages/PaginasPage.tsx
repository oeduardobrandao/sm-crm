import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ChevronRight, FileText } from 'lucide-react';
import { useHub } from '../HubContext';
import { fetchPages } from '../api';

export function PaginasPage() {
  const { token } = useHub();
  const { workspace } = useParams<{ workspace: string }>();
  const base = `/${workspace}/hub/${token}`;

  const { data, isLoading } = useQuery({
    queryKey: ['hub-pages', token],
    queryFn: () => fetchPages(token),
  });

  if (isLoading) return <div className="flex justify-center py-20"><div className="animate-spin h-6 w-6 rounded-full border-2 border-primary border-t-transparent" /></div>;

  const pages = data?.pages ?? [];

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-xl font-semibold mb-6">Páginas</h2>
      {pages.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nenhuma página foi criada ainda.</p>
      ) : (
        <div className="space-y-2">
          {pages.map(p => (
            <Link key={p.id} to={`${base}/paginas/${p.id}`}
              className="flex items-center justify-between border rounded-xl p-4 bg-white hover:bg-accent transition-colors">
              <div className="flex items-center gap-3">
                <FileText size={18} className="text-muted-foreground" />
                <span className="font-medium text-sm">{p.title}</span>
              </div>
              <ChevronRight size={16} className="text-muted-foreground" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
