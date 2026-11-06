import { useState, type CSSProperties } from 'react';
import { avatarColorClass } from '@/lib/avatarColor';
import { getInitials } from '@/lib/initials';
import { cn } from '@/lib/utils';

interface PessoaAvatarProps {
  nome: string;
  fotoUrl?: string | null;
  /** Colour seed for the initials (the person's id); falls back to the name. */
  seed?: string | number | null;
  /** Side in px. Without it the `.avatar` class (or `className`) sets the size. */
  size?: number;
  className?: string;
  alt?: string;
}

/**
 * A team member's avatar: the photo when there is one, otherwise the initials on the
 * deterministic colour. A photo that fails to load (deleted object, offline) falls back
 * to the initials; a different `fotoUrl` tries the image again.
 *
 * Imports `getInitials` from `@/lib/initials`, not `@/store`: page tests mock the store
 * wholesale (see initials.ts).
 */
export function PessoaAvatar({
  nome,
  fotoUrl,
  seed,
  size,
  className,
  alt = '',
}: PessoaAvatarProps) {
  // Remember which URL failed rather than a boolean: a new URL is a fresh attempt.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const style: CSSProperties | undefined =
    size === undefined ? undefined : { width: size, height: size, fontSize: size * 0.4 };

  if (fotoUrl && fotoUrl !== failedUrl) {
    return (
      <img
        className={cn('avatar avatar--photo', className)}
        src={fotoUrl}
        alt={alt}
        style={style}
        onError={() => setFailedUrl(fotoUrl)}
      />
    );
  }

  return (
    <div
      className={cn('avatar', avatarColorClass(seed ?? nome), className)}
      style={style}
      aria-hidden
    >
      {getInitials(nome)}
    </div>
  );
}
