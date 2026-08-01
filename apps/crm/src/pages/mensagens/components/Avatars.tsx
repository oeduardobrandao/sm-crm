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

/** Cliente avatar: connected Instagram photo when available, else sigla + cor,
 * else initials on the base .avatar tokens. */
export function ClienteAvatar({
  nome,
  fotoUrl,
  cliente,
  size = 'sm',
}: {
  nome: string;
  fotoUrl?: string | null;
  cliente?: Pick<Cliente, 'sigla' | 'cor'>;
  size?: 'sm' | 'lg';
}) {
  const dims = size === 'lg' ? LARGE : SMALL;
  if (fotoUrl) {
    return (
      <img
        src={fotoUrl}
        alt=""
        data-testid="cliente-avatar-foto"
        className="avatar"
        style={{ ...dims, objectFit: 'cover' }}
      />
    );
  }
  return (
    <div
      className="avatar"
      style={{
        ...dims,
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
 * the cliente's Instagram photo / sigla + cor for client items. */
export function AutorAvatar({
  item,
  cliente,
  clienteFotoUrl,
}: {
  item: MensagemFeedItem;
  cliente?: Pick<Cliente, 'sigla' | 'cor'>;
  clienteFotoUrl?: string | null;
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
  return <ClienteAvatar nome={item.cliente_nome} fotoUrl={clienteFotoUrl} cliente={cliente} />;
}
