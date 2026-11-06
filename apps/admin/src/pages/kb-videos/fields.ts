/** Shared form-field styling for the KB video forms (desktop). Tokens only, no colour literals. */
export const FIELD =
  'w-full rounded-xl border border-transparent bg-secondary px-3 py-2 text-sm focus:border-primary focus:outline-none disabled:opacity-60';
export const LABEL =
  'mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground';
export const RESERVED_SLUGS = ['novo', 'editar', 'video'];

/** Validation message for a slug, or null when it is empty or fine. */
export function slugProblem(slug: string): string | null {
  if (!slug) return null;
  if (RESERVED_SLUGS.includes(slug)) return 'Slug reservado';
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return 'Apenas letras minúsculas, números e hifens';
  return null;
}

export type PublishState = 'draft' | 'published';
export const STATUS_OPTIONS: Array<{ value: PublishState; label: string }> = [
  { value: 'draft', label: 'Rascunho' },
  { value: 'published', label: 'Publicado' },
];
