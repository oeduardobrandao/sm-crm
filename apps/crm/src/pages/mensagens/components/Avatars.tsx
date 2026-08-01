import type { Cliente, MensagemFeedItem } from '@/store';
import { avatarColorClass } from '@/lib/avatarColor';

export function initialsOf(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

const SMALL = { width: 28, height: 28, fontSize: '0.65rem', flexShrink: 0 } as const;
const LARGE = { width: 40, height: 40, fontSize: '0.8rem', flexShrink: 0 } as const;

/** Cliente avatar: sigla + cor when known, initials on the base .avatar tokens otherwise. */
export function ClienteAvatar({
  nome,
  cliente,
  size = 'sm',
}: {
  nome: string;
  cliente?: Pick<Cliente, 'sigla' | 'cor'>;
  size?: 'sm' | 'lg';
}) {
  return (
    <div
      className="avatar"
      style={{
        ...(size === 'lg' ? LARGE : SMALL),
        background: cliente?.cor || undefined,
        color: cliente?.cor ? '#fff' : undefined,
      }}
      aria-hidden="true"
    >
      {cliente?.sigla || initialsOf(nome)}
    </div>
  );
}

/** Feed-item author avatar: member photo or seeded initials for agency items,
 * the cliente's sigla + cor for client items. */
export function AutorAvatar({
  item,
  cliente,
}: {
  item: MensagemFeedItem;
  cliente?: Pick<Cliente, 'sigla' | 'cor'>;
}) {
  if (item.is_workspace_user) {
    if (item.author_avatar_url) {
      return (
        <img
          src={item.author_avatar_url}
          alt=""
          className="avatar"
          style={{ ...SMALL, objectFit: 'cover' }}
        />
      );
    }
    const name = item.author_name ?? 'Equipe';
    return (
      <div
        className={`avatar ${avatarColorClass(item.author_user_id ?? name)}`}
        style={SMALL}
        aria-hidden="true"
      >
        {initialsOf(name)}
      </div>
    );
  }
  return <ClienteAvatar nome={item.cliente_nome} cliente={cliente} />;
}
