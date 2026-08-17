import { AlertTriangle, ArrowLeft, MessageCircle, SearchX } from 'lucide-react';
import { Link } from 'react-router-dom';

const WRAPPER =
  'flex-1 min-w-0 relative flex flex-col items-center justify-center gap-2 py-16 text-center';

function BackButton({ onBack }: { onBack?: () => void }) {
  if (!onBack) return null;
  return (
    <button
      onClick={onBack}
      aria-label="Voltar para as conversas"
      className="absolute left-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-main)]"
      style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
    >
      <ArrowLeft size={17} />
    </button>
  );
}

/** Desktop only — nothing selected yet. Never reachable on mobile, where the
 * list itself is the whole screen until a conversation is picked. */
export function ThreadPlaceholder() {
  return (
    <div className={WRAPPER}>
      <MessageCircle className="h-8 w-8" style={{ color: 'var(--text-light)' }} />
      <p className="text-sm text-[var(--text-muted)]">Selecione uma conversa</p>
    </div>
  );
}

export function ThreadNotFound({ onBack }: { onBack?: () => void }) {
  return (
    <div className={WRAPPER}>
      <BackButton onBack={onBack} />
      <SearchX className="h-8 w-8" style={{ color: 'var(--text-light)' }} />
      <p className="text-sm text-[var(--text-muted)]">Conversa não encontrada.</p>
      {!onBack && (
        <Link
          to="/mensagens"
          className="text-sm font-semibold text-[var(--text-main)] hover:underline"
        >
          Voltar para as conversas
        </Link>
      )}
    </div>
  );
}

export function ThreadLoading({ onBack }: { onBack?: () => void }) {
  return (
    <div className={WRAPPER}>
      <BackButton onBack={onBack} />
      <p className="text-sm text-[var(--text-muted)]">Carregando…</p>
    </div>
  );
}

export function ThreadLoadError({ onRetry, onBack }: { onRetry: () => void; onBack?: () => void }) {
  return (
    <div className={WRAPPER}>
      <BackButton onBack={onBack} />
      <AlertTriangle className="h-8 w-8" style={{ color: 'var(--text-light)' }} />
      <p className="text-sm text-[var(--text-muted)]">Não foi possível carregar as conversas.</p>
      <button
        onClick={onRetry}
        className="text-sm font-semibold text-[var(--text-main)] hover:underline"
        style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
      >
        Tentar novamente
      </button>
    </div>
  );
}
