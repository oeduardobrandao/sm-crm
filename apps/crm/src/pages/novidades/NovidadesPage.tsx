import changelogData from '@/content/changelog.json';
import { parseReleases, type ChangelogRelease } from '@/content/changelog.schema';

const TYPE_BADGE: Record<
  ChangelogRelease['items'][number]['type'],
  { label: string; color: string; bg: string }
> = {
  feature: { label: 'Novo', color: '#3ecf8e', bg: 'rgba(62,207,142,0.12)' },
  improvement: { label: 'Melhoria', color: '#42c8f5', bg: 'rgba(66,200,245,0.12)' },
  fix: { label: 'Correção', color: '#f5a342', bg: 'rgba(245,163,66,0.12)' },
};

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(new Date(y, m - 1, d));
}

export default function NovidadesPage({ releases }: { releases?: ChangelogRelease[] }) {
  const data = releases ?? parseReleases(changelogData);

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '2rem 1rem' }} className="animate-up">
      <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
        <h1
          style={{
            fontFamily: 'var(--font-heading)',
            fontSize: '2.5rem',
            color: 'var(--text-main)',
            marginBottom: '0.5rem',
          }}
        >
          Novidades
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem' }}>
          O que há de novo no Mesaas. Atualizado toda semana.
        </p>
      </div>

      {data.length === 0 ? (
        <p style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
          Em breve, novidades por aqui.
        </p>
      ) : (
        data.map((release) => (
          <div key={release.date} className="card" style={{ marginBottom: '1.5rem' }}>
            <div
              style={{
                marginBottom: '1rem',
                paddingBottom: '0.75rem',
                borderBottom: '1px solid var(--border-color)',
              }}
            >
              <h2
                style={{
                  fontFamily: 'var(--font-heading)',
                  fontSize: '1.4rem',
                  color: 'var(--primary-color)',
                }}
              >
                {formatDate(release.date)}
              </h2>
              {release.summary && (
                <p
                  style={{ color: 'var(--text-muted)', fontSize: '0.95rem', marginTop: '0.25rem' }}
                >
                  {release.summary}
                </p>
              )}
            </div>

            {release.items.map((item) => {
              const badge = TYPE_BADGE[item.type];
              return (
                <div key={item.pr} style={{ marginBottom: '1.25rem' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      marginBottom: '0.35rem',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '0.65rem',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                        color: badge.color,
                        background: badge.bg,
                        padding: '0.2rem 0.5rem',
                        borderRadius: 2,
                      }}
                    >
                      {badge.label}
                    </span>
                    <span
                      style={{
                        fontSize: '0.7rem',
                        color: 'var(--text-light)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                      }}
                    >
                      {item.area}
                    </span>
                  </div>
                  <h3
                    style={{
                      fontSize: '1.05rem',
                      fontWeight: 700,
                      color: 'var(--text-main)',
                      marginBottom: '0.2rem',
                    }}
                  >
                    {item.title}
                  </h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', lineHeight: 1.6 }}>
                    {item.description}
                  </p>
                </div>
              );
            })}
          </div>
        ))
      )}

      <p style={{ textAlign: 'center', marginTop: '2rem' }}>
        <a href="/" style={{ color: 'var(--primary-color)', textDecoration: 'underline' }}>
          Voltar para o início
        </a>
      </p>
    </div>
  );
}
