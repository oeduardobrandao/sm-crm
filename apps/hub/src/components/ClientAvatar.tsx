import { useState } from 'react';

/**
 * The client's photo — their connected Instagram avatar, the same image the CRM
 * shows on the client detail page. Falls back to the initial when no account is
 * linked, and also when the image fails to load: the avatar is served from a
 * public bucket, but a stale row can still point at an expired CDN url, and a
 * broken-image glyph next to the client's own name reads worse than a monogram.
 */
export function ClientAvatar({
  name,
  photoUrl,
  size = 28,
}: {
  name: string;
  photoUrl: string | null;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const initial = name.trim().charAt(0).toUpperCase();
  const box = { width: size, height: size };

  if (photoUrl && !failed) {
    return (
      <img
        src={photoUrl}
        alt=""
        style={box}
        onError={() => setFailed(true)}
        className="rounded-full object-cover flex-shrink-0 border hub-border"
      />
    );
  }

  return (
    <div
      style={box}
      aria-hidden="true"
      className="rounded-full flex items-center justify-center flex-shrink-0 text-[11px] font-semibold hub-bg-soft hub-tx2 border hub-border"
    >
      {initial}
    </div>
  );
}
