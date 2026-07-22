import { useState } from 'react';
import { useHub } from '../HubContext';

/**
 * The agency's logo, shown beside the workspace name wherever that name appears
 * — sidebar, mobile top bar, mobile drawer. Falls back to the initial when the
 * workspace has no logo, and also when the image fails to load: logo_url is
 * operator-supplied and can rot, and a broken-image glyph beside the agency's
 * own name is worse than a monogram.
 */
export function WorkspaceMark({ size = 36 }: { size?: number }) {
  const { bootstrap } = useHub();
  const [failed, setFailed] = useState(false);
  const { logo_url: logoUrl, name } = bootstrap.workspace;
  const box = { width: size, height: size };

  if (logoUrl && !failed) {
    return (
      <img
        src={logoUrl}
        alt={name}
        style={box}
        onError={() => setFailed(true)}
        className="rounded-full object-cover flex-shrink-0"
      />
    );
  }

  return (
    <div
      style={{ ...box, fontSize: Math.round(size * 0.44) }}
      aria-hidden="true"
      className="rounded-full flex items-center justify-center font-display font-semibold flex-shrink-0 hub-btn-primary"
    >
      {name.trim().charAt(0).toUpperCase()}
    </div>
  );
}
