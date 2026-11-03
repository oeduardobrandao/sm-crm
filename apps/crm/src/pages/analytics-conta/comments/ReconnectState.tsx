import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { CommentsApiError } from '../../../services/instagramComments';

/** Errors only a reconnection fixes: the comments scope is missing (409) or the
 *  Instagram token expired (401 `TOKEN_EXPIRED`). Any other 401 (the user's own session)
 *  falls through to the generic message. */
export function reconnectReason(e: unknown): 'scope' | 'expired' | null {
  if (!(e instanceof CommentsApiError)) return null;
  if (e.code === 'missing_comments_scope') return 'scope';
  if (e.status === 401 && e.code === 'TOKEN_EXPIRED') return 'expired';
  return null;
}

/** The "reconnect Instagram" state shared by the post panel and the account card. */
export function ReconnectState({
  clientId,
  reason,
}: {
  clientId: number;
  reason: 'scope' | 'expired';
}) {
  const navigate = useNavigate();
  return (
    <div className="igc-card igc-state">
      <h3 className="igc-eyebrow">
        {reason === 'expired' ? 'Conexão expirada' : 'Sem permissão de comentários'}
      </h3>
      <p className="igc-state__text">
        {reason === 'expired'
          ? 'A conexão com o Instagram expirou. Reconecte para ver os comentários.'
          : 'Para ver os comentários, reconecte o Instagram deste cliente e aceite a permissão de comentários.'}
      </p>
      <Button
        variant="outline"
        className="igc-btn"
        onClick={() => navigate(`/clientes/${clientId}/redes-sociais`)}
      >
        Reconectar Instagram
      </Button>
    </div>
  );
}
