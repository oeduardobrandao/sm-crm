import { cn } from '../../lib/utils';

/** The signed-in admin's e-mail initial on a gold disc (Mais sheet, sidebar footer). */
export function AccountAvatar({ email, large }: { email: string; large?: boolean }) {
  const initial = email.trim().charAt(0) || '?';
  return (
    <span className={cn('admin-avatar', large && 'admin-avatar--lg')} aria-hidden="true">
      {initial}
    </span>
  );
}
