import { useEffect, useState } from 'react';
import { sanitizeExternalUrl } from '../../lib/security';

/**
 * The workspace logo on the invite page, or its initial when there is none or it fails to
 * load. A context-free cousin of WorkspaceMark (which reads the portal's bootstrap).
 */
export function ConviteMarca({
  nome,
  logoUrl,
  size = 36,
}: {
  nome: string;
  logoUrl: string | null;
  size?: number;
}) {
  const src = logoUrl ? sanitizeExternalUrl(logoUrl) : '#';
  const [falhou, setFalhou] = useState(false);
  useEffect(() => setFalhou(false), [src]);

  if (src !== '#' && !falhou) {
    return (
      <img
        src={src}
        alt={nome}
        style={{ width: size, height: size }}
        onError={() => setFalhou(true)}
        className="rounded-full object-cover flex-shrink-0"
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.44) }}
      className="rounded-full flex items-center justify-center font-display font-semibold flex-shrink-0 hub-btn-primary"
    >
      {nome.trim().charAt(0).toUpperCase()}
    </div>
  );
}
