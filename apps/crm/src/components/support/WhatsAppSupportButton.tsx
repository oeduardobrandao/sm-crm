import type { CSSProperties, ReactNode } from 'react';
import { useAuth } from '@/context/AuthContext';
import { captureEvent } from '@/lib/analytics';
import { buildWhatsAppSupportUrl, type WhatsAppContext } from '@/lib/whatsapp';

interface Props {
  context: WhatsAppContext;
  label: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Runs after the click is captured, e.g. to remember that the chat was opened. */
  onOpen?: () => void;
}

/**
 * Deliberately not presentational: it reads useAuth() rather than taking `nome`
 * and `empresa` as props. Both CRM surfaces would otherwise prop-drill the same
 * two fields, which is the shortest path to the two screens drifting apart.
 *
 * Renders nothing when the support number is unset or malformed.
 */
/**
 * Extra attributes (e.g. `data-slot="button"`, `data-variant`) land on the anchor, so a
 * link styled with `buttonVariants` also picks up the Vidro skin, which keys on them.
 */
export function WhatsAppSupportButton({
  context,
  label,
  className,
  style,
  onOpen,
  ...rest
}: Props & Record<`data-${string}`, string>) {
  const { profile } = useAuth();
  // getCurrentProfile() does select('*') into an `any` cache, so the row is
  // untyped at every call site in this repo. Read through a narrow cast.
  const row = profile as unknown as Record<string, string | null> | null;

  const href = buildWhatsAppSupportUrl({
    nome: row?.nome,
    // profiles.empresa is the user's own company, set at signup. It is NOT the
    // active workspace name, and for a prefill that identifies a person it is
    // the right field.
    empresa: row?.empresa,
    context,
  });
  if (!href) return null;

  return (
    <a
      {...rest}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      style={style}
      onClick={() => {
        // sendInstantly: on mobile the switch to the WhatsApp app can suspend
        // the page before posthog-js flushes its queue.
        captureEvent('whatsapp_support_clicked', { context }, { sendInstantly: true });
        onOpen?.();
      }}
    >
      {label}
    </a>
  );
}
