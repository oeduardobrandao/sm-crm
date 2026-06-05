import { Link } from 'react-router-dom';
import {
  Rocket,
  Users,
  UsersRound,
  Kanban,
  Globe,
  Instagram,
  Zap,
  DollarSign,
  FolderOpen,
  type LucideIcon,
} from 'lucide-react';

const SECTION_ICONS: Record<string, LucideIcon> = {
  'primeiros-passos': Rocket,
  clientes: Users,
  equipe: UsersRound,
  'entregas-e-fluxos': Kanban,
  'hub-do-cliente': Globe,
  'instagram-e-analytics': Instagram,
  'post-express': Zap,
  financeiro: DollarSign,
  arquivos: FolderOpen,
};

interface SectionCardProps {
  category: string;
  label: string;
  articleCount: number;
}

export function SectionCard({ category, label, articleCount }: SectionCardProps) {
  const Icon = SECTION_ICONS[category] ?? Rocket;

  return (
    <Link
      to={`/ajuda/secao/${encodeURIComponent(category)}`}
      className="group block rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-6 transition-all hover:shadow-lg hover:-translate-y-0.5"
    >
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[rgba(234,179,8,0.1)]">
        <Icon className="h-5 w-5 text-[var(--primary-color)]" />
      </div>
      <h3 className="mb-1 text-[1.05rem] font-bold text-[var(--text-main)] font-[var(--font-heading)]">
        {label}
      </h3>
      <p className="text-[0.78rem] text-[var(--text-light)]">
        {articleCount} {articleCount === 1 ? 'artigo' : 'artigos'}
      </p>
    </Link>
  );
}
