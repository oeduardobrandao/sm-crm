import { Badge } from '../../components/ui/badge';
import { CATEGORY_LABEL, formatDay, type FilePostRow } from './blog-view';
import { LiveLinkButtons } from './LiveLinkButtons';

/** Read-only detail of a hand-written post: it lives as a file in the CRM, so the Admin only
 * shows its metadata and links to the live page. */
export function FilePostDetail({ post }: { post: FilePostRow }) {
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-[18px] py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="neutral" size="sm">
              Escrito à mão
            </Badge>
            <span className="text-xs text-muted-foreground">
              Publicado em {formatDay(post.date)}
            </span>
          </div>
          <h2 className="mt-1 font-sf text-[17px] font-bold leading-snug">{post.title}</h2>
          <p className="break-all text-xs text-muted-foreground">/blog/{post.slug}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LiveLinkButtons slug={post.slug} />
        </div>
      </div>
      <div className="flex flex-col gap-3 px-[18px] py-4 text-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
          {CATEGORY_LABEL[post.category] ?? post.category}
        </p>
        <p>{post.description}</p>
        <p className="text-muted-foreground">
          Este post vive no código (apps/crm/src/content/blog). Edite pelo repositório.
        </p>
      </div>
    </div>
  );
}
