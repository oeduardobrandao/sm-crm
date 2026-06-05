import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, Pencil } from 'lucide-react';
import { listKbArticles, type KbArticle } from '../lib/api';

const CATEGORIES: Record<string, string> = {
  'primeiros-passos': 'Getting Started',
  clientes: 'Clients',
  equipe: 'Team',
  'entregas-e-fluxos': 'Deliveries & Flows',
  'hub-do-cliente': 'Client Hub',
  'instagram-e-analytics': 'Instagram & Analytics',
  'post-express': 'Post Express',
  financeiro: 'Financial',
  arquivos: 'Files',
};

const ALL_CATEGORIES = Object.keys(CATEGORIES);
const STATUSES = ['draft', 'published'] as const;

function getStatusBadge(status: string) {
  if (status === 'published') return { label: 'PUBLISHED', cls: 'text-success bg-success/15' };
  return { label: 'DRAFT', cls: 'text-muted-foreground bg-secondary' };
}

export default function KbArticlesPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'kb-articles', statusFilter, categoryFilter],
    queryFn: () =>
      listKbArticles({
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(categoryFilter ? { category: categoryFilter } : {}),
      }),
  });

  const articles = (data?.articles || []).filter(
    (a) => !search || a.title.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
        <div>
          <h1 className="font-['Playfair_Display'] text-2xl font-bold mb-1">Knowledge Base</h1>
          <p className="text-sm text-muted-foreground">Manage help articles for CRM users</p>
        </div>
        <button
          onClick={() => navigate('/admin/kb-articles/new')}
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary-hover transition-colors"
        >
          <Plus size={16} /> New Article
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <input
          type="text"
          placeholder="Search articles..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-3 py-2.5 rounded-lg bg-card border border-border text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary"
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-3 py-2.5 rounded-lg bg-card border border-border text-sm text-muted-foreground focus:outline-none focus:border-primary"
        >
          <option value="">All Categories</option>
          {ALL_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORIES[c]}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2.5 rounded-lg bg-card border border-border text-sm text-muted-foreground focus:outline-none focus:border-primary"
        >
          <option value="">All Statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="hidden md:grid grid-cols-[2fr_1fr_0.7fr_0.7fr_0.5fr] gap-2 text-[0.7rem] text-muted-foreground uppercase tracking-wider pb-3 border-b border-border">
          <span>Title</span>
          <span>Category</span>
          <span>Status</span>
          <span>Order</span>
          <span></span>
        </div>

        {isLoading ? (
          <p className="text-sm text-dim-foreground py-4">Loading...</p>
        ) : articles.length === 0 ? (
          <p className="text-sm text-dim-foreground py-4">No articles found.</p>
        ) : (
          articles.map((a) => {
            const badge = getStatusBadge(a.status);
            const catLabel = CATEGORIES[a.category] ?? a.category;
            return (
              <div
                key={a.id}
                onClick={() => navigate(`/admin/kb-articles/${a.id}/edit`)}
                className={`cursor-pointer hover:bg-secondary/30 transition-colors border-b border-border/50 py-3 -mx-5 px-5 ${a.status === 'draft' ? 'opacity-50' : ''}`}
              >
                <div className="md:hidden flex flex-col gap-1.5">
                  <span className="text-sm font-medium truncate">{a.title}</span>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{catLabel}</span>
                    <span
                      className={`text-[0.65rem] font-semibold uppercase px-1.5 py-0.5 rounded-sm ${badge.cls}`}
                    >
                      {badge.label}
                    </span>
                  </div>
                </div>
                <div className="hidden md:grid grid-cols-[2fr_1fr_0.7fr_0.7fr_0.5fr] gap-2 items-center">
                  <div>
                    <div className="text-sm font-medium truncate">{a.title}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">/{a.slug}</div>
                  </div>
                  <span className="text-sm text-muted-foreground">{catLabel}</span>
                  <span
                    className={`text-[0.65rem] font-semibold uppercase px-1.5 py-0.5 rounded-sm w-fit ${badge.cls}`}
                  >
                    {badge.label}
                  </span>
                  <span className="text-sm text-muted-foreground">{a.display_order}</span>
                  <span className="text-muted-foreground hover:text-primary">
                    <Pencil size={14} />
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
