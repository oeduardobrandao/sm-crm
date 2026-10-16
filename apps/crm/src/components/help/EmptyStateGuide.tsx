import React from 'react';
import { Link } from 'react-router-dom';
import { useVidroShell } from '@/components/layout/PageToolbarContext';

interface EmptyStateGuideProps {
  icon: React.ReactNode;
  title: string;
  description: React.ReactNode;
  actionLabel: string;
  actionHref: string;
  hint?: string;
}

export function EmptyStateGuide({
  icon,
  title,
  description,
  actionLabel,
  actionHref,
  hint,
}: EmptyStateGuideProps) {
  // Empty states are neutral facts, not alerts: quiet surface, ink link.
  // Under the Vidro shell the surface and text colours come from cards.css (.vidro-empty).
  const vidroShell = useVidroShell();
  return (
    <div
      className={
        vidroShell
          ? 'rounded-xl px-4 py-5 flex flex-col gap-2 vidro-empty'
          : 'rounded-xl px-4 py-5 flex flex-col gap-2'
      }
      style={
        vidroShell
          ? undefined
          : { border: '1px solid var(--border-color)', background: 'var(--surface-hover)' }
      }
    >
      <div className="flex items-center gap-2">
        <span className="text-xl">{icon}</span>
        <span
          className="font-semibold text-sm"
          style={vidroShell ? undefined : { color: 'var(--text-main)' }}
        >
          {title}
        </span>
      </div>
      <p className="text-sm" style={vidroShell ? undefined : { color: 'var(--text-muted)' }}>
        {description}{' '}
        <Link
          to={actionHref}
          className="font-semibold underline underline-offset-2"
          style={{ color: 'var(--text-main)' }}
        >
          {actionLabel}
        </Link>
      </p>
      {hint && (
        <p className="text-xs" style={vidroShell ? undefined : { color: 'var(--text-light)' }}>
          {hint}
        </p>
      )}
    </div>
  );
}
