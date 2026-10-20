// Prévia compacta do post no Instagram (Post Express). Mesma marcação no desktop,
// dentro da etapa Envio, e no celular, dentro da folha "Preview".
import type { PostMedia } from '../../store';

export interface ExpressPreviewProps {
  igAccount: { username: string | null; profile_picture_url: string | null };
  isStory: boolean;
  mediaList: PostMedia[];
  caption: string;
  /** Texto no lugar da mídia enquanto não há nenhuma. */
  emptyLabel: string;
  /** Ocupa a largura do contêiner em vez dos 240px da prévia compacta (coluna do Vidro). */
  fill?: boolean;
}

export function ExpressPreview({
  igAccount,
  isStory,
  mediaList,
  caption,
  emptyLabel,
  fill,
}: ExpressPreviewProps) {
  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ background: '#000', padding: '0.75rem', maxWidth: fill ? undefined : '240px' }}
    >
      <div className="flex items-center gap-2 mb-2">
        {igAccount.profile_picture_url ? (
          <img
            src={igAccount.profile_picture_url}
            alt=""
            className="w-6 h-6 rounded-full"
            style={{ border: '1.5px solid #E1306C' }}
          />
        ) : (
          <div
            className="w-6 h-6 rounded-full"
            style={{ background: 'linear-gradient(45deg, #f09433, #dc2743, #bc1888)' }}
          />
        )}
        <span className="text-xs font-semibold" style={{ color: '#e8eaf0' }}>
          @{igAccount.username ?? 'conta'}
        </span>
      </div>
      <div
        className="rounded-lg overflow-hidden"
        style={{
          background: '#1a1e26',
          aspectRatio: isStory ? '9 / 16' : '1',
          maxWidth: isStory ? '150px' : undefined,
          margin: isStory ? '0 auto' : undefined,
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {isStory && mediaList.length > 1 && (
          <>
            <div
              style={{
                position: 'absolute',
                top: 6,
                left: 6,
                right: 6,
                display: 'flex',
                gap: 3,
                zIndex: 2,
              }}
            >
              {mediaList.map((m, i) => (
                <span
                  key={m.id}
                  style={{
                    flex: 1,
                    height: 2.5,
                    borderRadius: 2,
                    background: i === 0 ? '#fff' : 'rgba(255,255,255,0.35)',
                  }}
                />
              ))}
            </div>
            <span
              style={{
                position: 'absolute',
                top: 12,
                right: 8,
                zIndex: 2,
                color: '#fff',
                fontSize: '0.6rem',
                background: 'rgba(0,0,0,0.5)',
                padding: '1px 6px',
                borderRadius: 8,
              }}
            >
              1/{mediaList.length}
            </span>
          </>
        )}
        {mediaList.length > 0 && mediaList[0].url ? (
          mediaList[0].kind === 'video' ? (
            <video
              src={mediaList[0].url}
              poster={mediaList[0].thumbnail_url ?? undefined}
              muted
              className="w-full h-full object-cover"
            />
          ) : (
            <img
              src={mediaList[0].thumbnail_url ?? mediaList[0].url}
              alt=""
              className="w-full h-full object-cover"
            />
          )
        ) : (
          <span className="text-xs" style={{ color: '#4b5563' }}>
            {emptyLabel}
          </span>
        )}
      </div>
      {!isStory && caption && (
        <p className="mt-2 text-xs leading-relaxed" style={{ color: '#9ca3af' }}>
          <strong style={{ color: '#e8eaf0' }}>@{igAccount.username ?? 'conta'}</strong>{' '}
          {caption.length > 100 ? caption.slice(0, 100) + '...' : caption}
        </p>
      )}
    </div>
  );
}
