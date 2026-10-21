import type { CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Users } from 'lucide-react';
import { toast } from 'sonner';
import { signEquipeChatAnexoView } from '@/services/equipeChatMedia';
import type { EquipeConversa, EquipeMensagemAnexo } from '@/store';
import { PessoaAvatar } from '@/components/PessoaAvatar';

/** Types the composer's file picker offers (the edge function's allowlist). */
export const EQUIPE_ANEXO_ACCEPT =
  'image/jpeg,image/png,image/gif,image/webp,application/pdf,application/zip';

export function anexoSizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

/** Image attachment thumbnail: signs its view URL on demand (cached 8min —
 * presigned URLs live longer than that, so a re-render inside the window
 * reuses the same one instead of re-signing). */
export function AnexoImagem({
  anexo,
  className = 'mt-1 max-h-56 rounded-lg',
}: {
  anexo: EquipeMensagemAnexo;
  className?: string;
}) {
  const { data: url, isError } = useQuery({
    queryKey: ['equipe-anexo-url', anexo.id],
    queryFn: () => signEquipeChatAnexoView(anexo.id),
    staleTime: 8 * 60_000,
  });
  return (
    <img
      data-testid="anexo-imagem"
      className={className}
      style={{ cursor: 'pointer' }}
      src={url}
      alt={anexo.file_name}
      onClick={() => {
        if (url) {
          window.open(url, '_blank', 'noopener,noreferrer');
          return;
        }
        // Mirrors AnexoChip's error handling: same toast when the signed URL
        // is unavailable because signing failed. Still-loading is a silent
        // no-op, same as before.
        if (isError) toast.error('Não foi possível abrir o arquivo.');
      }}
    />
  );
}

/** Non-image attachment (PDF, ZIP): signs its URL only when clicked. */
export function AnexoChip({
  anexo,
  className = 'mt-1 flex items-center gap-1.5 rounded-lg border border-[var(--border-color)] px-2.5 py-1.5 text-xs',
  style = { background: 'var(--card-bg)', cursor: 'pointer' },
}: {
  anexo: EquipeMensagemAnexo;
  className?: string;
  style?: CSSProperties;
}) {
  async function abrir() {
    try {
      const url = await signEquipeChatAnexoView(anexo.id);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      toast.error('Não foi possível abrir o arquivo.');
    }
  }
  return (
    <button type="button" onClick={() => void abrir()} className={className} style={style}>
      <FileText size={14} aria-hidden="true" />
      <span className="max-w-[160px] truncate">{anexo.file_name}</span>
      <span className="text-[var(--text-muted)]">{anexoSizeLabel(anexo.size_bytes)}</span>
    </button>
  );
}

/**
 * Initials font per chat avatar, as full class names so Tailwind sees them. `!` because
 * PessoaAvatar's `size` sets an inline `size * 0.4` font and `.avatar` outranks plain
 * utilities.
 */
const CHAT_INITIALS_FONT = {
  '0.65rem': '!text-[0.65rem]',
  '0.7rem': '!text-[0.7rem]',
  '0.8rem': '!text-[0.8rem]',
} as const;

/**
 * A colleague's avatar in the team chat: the photo, else the initials on the plain
 * `.avatar` amber the chat has always used (not the seeded palette PessoaAvatar adds,
 * hence the `!` overrides of `.avatar--cN`'s variables).
 */
export function EquipePessoaAvatar({
  nome,
  fotoUrl,
  seed,
  size,
  fontSize,
}: {
  nome: string;
  fotoUrl: string | null;
  seed?: string | null;
  size: number;
  fontSize: keyof typeof CHAT_INITIALS_FONT;
}) {
  return (
    <PessoaAvatar
      nome={nome}
      fotoUrl={fotoUrl}
      seed={seed}
      size={size}
      className={CHAT_INITIALS_FONT[fontSize]}
    />
  );
}

/** Conversation avatar: the colleague's photo or initials for a DM, a group icon
 * for a group. `size` is the circle's side in px. */
export function EquipeConversaAvatar({
  conversa,
  size,
}: {
  conversa: Pick<EquipeConversa, 'tipo' | 'avatar_url' | 'display_nome'>;
  size: number;
}) {
  const fontSize = size >= 40 ? '0.8rem' : '0.65rem';
  if (conversa.tipo === 'dm') {
    return (
      <EquipePessoaAvatar
        nome={conversa.display_nome}
        fotoUrl={conversa.avatar_url}
        size={size}
        fontSize={fontSize}
      />
    );
  }
  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize,
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      aria-hidden="true"
    >
      <Users size={Math.round(size * 0.45)} />
    </span>
  );
}
