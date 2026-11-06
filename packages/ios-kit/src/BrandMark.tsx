/**
 * The Mesaas mark at the left of a phone header row (root screens and the shell bar).
 * Pass `alt=""` where visible text beside it already says "Mesaas".
 */
export function BrandMark({ alt = 'Mesaas' }: { alt?: string }) {
  return <img className="phone-brand-mark" src="/icon.svg" alt={alt} />;
}
