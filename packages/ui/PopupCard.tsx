import type { CSSProperties, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Card do popup global (spec 2026-09-04). Puramente visual e controlado: quem monta
 * decide a página, os labels e o que cada botão faz. Usado pelo preview do admin e
 * pelo GlobalPopupHost do CRM, por isso não importa nada de apps/*.
 *
 * Tokens legados do CRM com fallback claro: no CRM segue o tema (light/dark), no
 * admin renderiza claro. Layout com Tailwind (ambos os apps compilam packages/**).
 */
export interface PopupCardPage {
  title: string;
  eyebrow?: string | null;
  body: string;
  imageUrl?: string | null;
}

export interface PopupCardProps {
  pages: PopupCardPage[];
  page: number;
  onPageChange: (index: number) => void;
  ctaLabel?: string | null;
  ctaStyle: 'ink' | 'brand';
  secondaryLabel: string;
  requireAck: boolean;
  sanitizeHref: (href: string) => string;
  onCta?: () => void;
  onSecondary: () => void;
  onClose: () => void;
  titleId?: string;
  bodyId?: string;
}

export function defaultSecondaryLabel(requireAck: boolean, hasCta: boolean): string {
  if (requireAck) return 'Entendi';
  return hasCta ? 'Agora não' : 'Fechar';
}

const card: CSSProperties = {
  background: 'var(--card-bg, #ffffff)',
  color: 'var(--text-main, #12151a)',
  border: '1px solid var(--border-color, rgba(30,36,48,.1))',
  borderRadius: 12,
  boxShadow: '0 24px 60px rgba(0,0,0,.28)',
  overflow: 'hidden',
  fontFamily: 'var(--font-main, -apple-system, "SF Pro Text", system-ui, sans-serif)',
  width: '100%',
  maxWidth: 420,
};

const muted: CSSProperties = { color: 'var(--text-muted, #374151)' };

const btnBase: CSSProperties = {
  height: 40,
  padding: '0 16px',
  borderRadius: 10,
  fontSize: 14,
  fontWeight: 600,
  border: '1px solid transparent',
  cursor: 'pointer',
};

const btnStyles: Record<'ink' | 'brand' | 'ghost' | 'link', CSSProperties> = {
  ink: { ...btnBase, background: '#12151a', color: '#ffffff' },
  brand: { ...btnBase, background: '#ffbf30', color: '#12151a' },
  ghost: {
    ...btnBase,
    background: 'transparent',
    color: 'var(--text-muted, #374151)',
    borderColor: 'var(--border-color, rgba(30,36,48,.16))',
  },
  link: {
    ...btnBase,
    background: 'transparent',
    color: 'var(--text-muted, #374151)',
    padding: '0 6px',
  },
};

function Btn({
  kind,
  onClick,
  children,
  className,
}: {
  kind: keyof typeof btnStyles;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button type="button" onClick={onClick} style={btnStyles[kind]} className={className}>
      {children}
    </button>
  );
}

export function PopupCard({
  pages,
  page,
  onPageChange,
  ctaLabel,
  ctaStyle,
  secondaryLabel,
  requireAck,
  sanitizeHref,
  onCta,
  onSecondary,
  onClose,
  titleId,
  bodyId,
}: PopupCardProps) {
  // Componente compartilhado: um host que passe [] não pode derrubar a árvore.
  if (pages.length === 0) return null;

  const total = pages.length;
  const index = Math.min(Math.max(page, 0), total - 1);
  const current = pages[index];
  const isFirst = index === 0;
  const isLast = index === total - 1;
  const multi = total > 1;
  const hasCta = Boolean(ctaLabel && onCta);

  const counter = multi ? `${index + 1} de ${total}` : null;
  const eyebrow = current.eyebrow
    ? counter
      ? `${current.eyebrow} · ${counter}`
      : current.eyebrow
    : counter;

  const closeButton = !requireAck && (
    <button
      type="button"
      aria-label="Fechar"
      onClick={onClose}
      className="absolute right-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-full text-base leading-none"
      style={
        current.imageUrl
          ? { background: 'rgba(18,21,26,.55)', color: '#fff' }
          : { background: 'transparent', color: 'var(--text-muted, #4b5563)' }
      }
    >
      ×
    </button>
  );

  const dots = multi && (
    <div className="flex items-center gap-1.5" role="group" aria-label="Páginas">
      {pages.map((_, i) => (
        <button
          key={i}
          type="button"
          aria-label={`Página ${i + 1} de ${total}`}
          aria-current={i === index ? 'true' : undefined}
          onClick={() => onPageChange(i)}
          className="block h-1.5 rounded-full transition-all"
          style={{
            width: i === index ? 16 : 6,
            background: i === index ? 'var(--text-main, #12151a)' : 'rgba(128,128,128,.35)',
            border: 0,
            padding: 0,
            cursor: 'pointer',
          }}
        />
      ))}
    </div>
  );

  return (
    <div style={card} className="relative" data-popup-page={index}>
      {current.imageUrl ? (
        <div className="relative" style={{ aspectRatio: '16 / 9' }}>
          <img
            src={current.imageUrl}
            alt=""
            className="h-full w-full object-cover"
            style={{ display: 'block' }}
          />
          {closeButton}
        </div>
      ) : (
        closeButton
      )}

      <div className="relative px-[22px] pb-[22px] pt-5">
        {eyebrow && (
          <div
            className="mb-1.5 text-[11px] font-bold uppercase tracking-[.08em]"
            style={{ color: '#ca8a04' }}
          >
            {eyebrow}
          </div>
        )}
        <h2
          id={titleId}
          className="m-0 mb-2 text-[19px] font-bold leading-tight tracking-[-.01em]"
          style={{ fontFamily: 'var(--font-heading, inherit)' }}
        >
          {current.title}
        </h2>
        <div id={bodyId} className="text-sm leading-relaxed" style={muted}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => <p className="m-0 [&+p]:mt-2">{children}</p>,
              ul: ({ children }) => <ul className="mt-2 list-disc pl-[18px]">{children}</ul>,
              ol: ({ children }) => <ol className="mt-2 list-decimal pl-[18px]">{children}</ol>,
              a: ({ href, children }) => (
                <a
                  href={sanitizeHref(href ?? '')}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'inherit', textDecoration: 'underline' }}
                >
                  {children}
                </a>
              ),
            }}
          >
            {current.body}
          </ReactMarkdown>
        </div>

        {multi && !isLast && (
          <div className="mt-[18px] flex items-center justify-between gap-2.5">
            {isFirst ? (
              <span />
            ) : (
              <Btn kind="link" onClick={() => onPageChange(index - 1)}>
                Voltar
              </Btn>
            )}
            {dots}
            <Btn kind={ctaStyle} onClick={() => onPageChange(index + 1)}>
              Próximo
            </Btn>
          </div>
        )}

        {isLast && (
          <div className="mt-[18px] flex flex-col gap-2">
            {multi && (
              <div className="flex items-center justify-between">
                <Btn kind="link" onClick={() => onPageChange(index - 1)}>
                  Voltar
                </Btn>
                {dots}
              </div>
            )}
            <div className="flex flex-col gap-2.5 sm:flex-row">
              {hasCta && (
                <Btn kind={ctaStyle} onClick={onCta} className="flex-1">
                  {ctaLabel}
                </Btn>
              )}
              <Btn kind="ghost" onClick={onSecondary} className="flex-1">
                {secondaryLabel}
              </Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
