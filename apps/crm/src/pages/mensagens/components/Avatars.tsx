import { useTranslation } from 'react-i18next';
import type { Cliente, MensagemFeedItem } from '@/store';
import { PessoaAvatar } from '@/components/PessoaAvatar';
import { useFotoFallback } from '@/components/ClienteFoto';

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

/** Cliente avatar: connected Instagram photo when available, else the photo
 * uploaded on the client page, else sigla + cor, else initials on the base
 * .avatar tokens. A photo that fails to load falls through to the next. */
export function ClienteAvatar({
  nome,
  fotoUrl,
  cliente,
  size = 'sm',
}: {
  nome: string;
  fotoUrl?: string | null;
  cliente?: Pick<Cliente, 'sigla' | 'cor'> & Partial<Pick<Cliente, 'foto_url'>>;
  size?: 'sm' | 'lg';
}) {
  const dims = size === 'lg' ? LARGE : SMALL;
  const foto = useFotoFallback([fotoUrl, cliente?.foto_url]);
  if (foto.src) {
    return (
      <img
        src={foto.src}
        alt=""
        onError={foto.onError}
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
  cliente?: Pick<Cliente, 'sigla' | 'cor'> & Partial<Pick<Cliente, 'foto_url'>>;
  clienteFotoUrl?: string | null;
}) {
  const { t } = useTranslation('messages');
  if (item.is_workspace_user) {
    return (
      <PessoaAvatar
        nome={item.author_name ?? t('shared.team')}
        fotoUrl={item.author_avatar_url}
        seed={item.author_user_id}
        size={28}
        className="!text-[0.65rem]"
      />
    );
  }
  return <ClienteAvatar nome={item.cliente_nome} fotoUrl={clienteFotoUrl} cliente={cliente} />;
}
