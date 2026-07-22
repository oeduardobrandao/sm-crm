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

  const pages = data?.pages ?? [];

  return (
    <div className="max-w-3xl mx-auto hub-fade-up">
      <header className="mb-8">
        <h2 className="font-display text-[2rem] sm:text-[2.25rem] leading-[1.05] font-medium tracking-tight hub-txt">
          Páginas
        </h2>
      </header>
      {isLoading ? (
        <div className="flex justify-center py-20">
          <div className="animate-spin h-6 w-6 rounded-full border-2 border-stone-300 border-t-stone-900" />
        </div>
      ) : pages.length === 0 ? (
        <p className="hub-tx2 text-sm">Nenhuma página foi criada ainda.</p>
      ) : (
        <div className="space-y-2.5">
          {pages.map((p) => (
            <Link
              key={p.id}
              to={`${base}/paginas/${p.id}`}
              className="hub-card hub-card-hover hub-page-row flex items-center justify-between px-5 py-4 group"
            >
              <div className="flex items-center gap-3.5">
                <span className="flex items-center justify-center w-10 h-10 rounded-lg hub-bg-soft hub-tx2 transition-colors">
                  <FileText size={17} strokeWidth={1.75} />
                </span>
                <span className="font-display font-semibold text-[15px] tracking-tight hub-txt">
                  {p.title}
                </span>
              </div>
              <ChevronRight
                size={17}
                className="hub-page-chevron hub-tx3 group-hover:translate-x-0.5 transition-all"
              />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
