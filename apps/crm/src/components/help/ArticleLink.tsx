import { Link } from 'react-router-dom';
import { BookOpen } from 'lucide-react';

interface ArticleLinkProps {
  slug: string;
  label?: string;
}

export function ArticleLink({ slug, label = 'Saiba mais' }: ArticleLinkProps) {
  return (
    <Link
      to={`/ajuda/${slug}`}
      className="inline-flex items-center gap-1 text-[0.78rem] text-[var(--primary-color)] hover:underline transition-colors"
    >
      <BookOpen className="h-3.5 w-3.5" />
      {label}
    </Link>
  );
}
