import type { CSSProperties, HTMLAttributes, Ref } from 'react';
import { useFotoFallback } from '@/components/ClienteFoto';
import { getInitials } from '@/lib/initials';

type BoardClienteAvatarProps = HTMLAttributes<HTMLElement> & {
  /** Photo URLs, best first: the Instagram avatar, then the uploaded `foto_url`. */
  srcs: readonly (string | null | undefined)[];
  nome: string;
  cor?: string | null;
  alt?: string;
  /** Extra style for the photo only (the initials chip keeps its own). */
  imgStyle?: CSSProperties;
  ref?: Ref<HTMLElement>;
};

/**
 * The client chip on the posts board and list: the photo, or the initials on the
 * client's colour when none loads. Spreads the remaining props and the ref onto the
 * rendered element so it can sit directly under a Radix `TooltipTrigger asChild`.
 */
export function BoardClienteAvatar({
  srcs,
  nome,
  cor,
  alt = '',
  imgStyle,
  ref,
  ...rest
}: BoardClienteAvatarProps) {
  const { src, onError } = useFotoFallback(srcs);
  if (src) {
    return (
      <img
        {...rest}
        ref={ref as Ref<HTMLImageElement>}
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        className="board-post-cliente-avatar"
        style={imgStyle}
        onError={onError}
      />
    );
  }
  return (
    <span
      {...rest}
      ref={ref as Ref<HTMLSpanElement>}
      className="board-post-cliente-avatar board-post-cliente-avatar--initials"
      style={{ background: cor || 'var(--surface-hover)' }}
    >
      {getInitials(nome || '?')}
    </span>
  );
}
