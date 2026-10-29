// Pieces every card shares: shell, buttons, chips, copy helpers.
import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { resultText, type ToolCallResult } from './bridge';
import type { Tipo } from './types';

export const MESAAS_ORIGIN = 'https://www.mesaas.com.br';

export const postUrl = (postId: number) => `${MESAAS_ORIGIN}/entregas?post=${postId}`;
export const clientUrl = (clientId: number) => `${MESAAS_ORIGIN}/clientes/${clientId}`;

export const TIPO_LABEL: Record<Tipo, string> = {
  feed: 'Feed',
  carrossel: 'Carrossel',
  reels: 'Reels',
  stories: 'Stories',
};

export const STATUS_LABEL: Record<string, string> = {
  rascunho: 'Rascunho',
  revisao_interna: 'Em revisão',
  aprovado_interno: 'Aprovado internamente',
  enviado_cliente: 'Enviado ao cliente',
  aprovado_cliente: 'Aprovado pelo cliente',
  correcao_cliente: 'Correção solicitada',
  agendado: 'Agendado',
  postado: 'Postado',
  falha_publicacao: 'Falha na publicação',
};

const nf = new Intl.NumberFormat('pt-BR');
export const fmtInt = (n: number) => nf.format(n);

export const plural = (n: number, one: string, many: string) =>
  `${fmtInt(n)} ${n === 1 ? one : many}`;

/** pt-BR list: "a", "a e b", "a, b e c". */
export function joinPt(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}

const GENERIC_ERROR = 'Não deu certo agora. Tente de novo em instantes.';
const PERMISSION_ERROR =
  'Sua conexão com o Mesaas não tem permissão para isso. Reconecte o Mesaas marcando a permissão de posts.';

/** The SDK's own refusals, in English: an argument outside a tool's zod limits arrives as
 *  "MCP error -32602: Input validation error: ...", and an unknown or disabled tool as
 *  "MCP error -32602: Tool ... not found". */
const SDK_ERROR = /^(MCP error -?\d+: |Input validation error)/;

/** User-facing sentence for a failed tool call. Server messages are already safe pt-BR,
 *  except the generic English fallbacks of errorResult and the SDK's own errors, which are
 *  swapped here. */
export function errorMessage(r: ToolCallResult | undefined): string {
  const text = resultText(r?.content);
  if (!text || /^Internal error/i.test(text) || SDK_ERROR.test(text)) return GENERIC_ERROR;
  if (/^Permission denied/i.test(text)) return PERMISSION_ERROR;
  return text;
}

export const CALL_FAILED = GENERIC_ERROR;
export const MESSAGE_FAILED = 'O chat não aceitou a mensagem. Escreva o pedido na conversa.';
export const LINK_FAILED = 'O chat não abriu o link. Abra o Mesaas no navegador.';

/** Parses an existing tool's JSON-in-text result (create_post, update_post). */
export function resultJson(r: ToolCallResult): Record<string, unknown> | undefined {
  if (r.structuredContent && typeof r.structuredContent === 'object') {
    return r.structuredContent as Record<string, unknown>;
  }
  const first = r.content?.[0] as { type?: string; text?: string } | undefined;
  if (first?.type !== 'text' || typeof first.text !== 'string') return undefined;
  try {
    const v = JSON.parse(first.text) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

export function Card({
  label,
  title,
  subtitle,
  aside,
  children,
  footer,
}: {
  label: string;
  title: ReactNode;
  subtitle?: ReactNode;
  aside?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="mw-card" aria-label={label}>
      <header className="mw-head">
        <div className="mw-head-main">
          <span className="mw-logo" aria-hidden="true">
            M
          </span>
          <div className="mw-head-text">
            <strong className="mw-title">{title}</strong>
            {subtitle ? <span className="mw-sub">{subtitle}</span> : null}
          </div>
        </div>
        {aside}
      </header>
      {children ? <div className="mw-body">{children}</div> : null}
      {footer ? <footer className="mw-foot">{footer}</footer> : null}
    </section>
  );
}

export function Button({
  variant = 'default',
  busy,
  disabled,
  onClick,
  children,
  ...rest
}: {
  variant?: 'default' | 'outline' | 'ghost';
  busy?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
  'aria-describedby'?: string;
}) {
  return (
    <button
      type="button"
      className={`mw-btn mw-btn-${variant}`}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      onClick={onClick}
      {...rest}
    >
      {busy ? <Loader2 className="mw-spin" size={14} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function TipoBadge({ tipo }: { tipo: Tipo }) {
  return (
    <span className={`mw-tipo mw-tipo-${tipo}`}>
      <span className="mw-dot" aria-hidden="true" />
      {TIPO_LABEL[tipo] ?? tipo}
    </span>
  );
}

export function StatusChip({ status }: { status: string }) {
  return <span className={`mw-status mw-status-${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export function Notice({ tone, children }: { tone: 'info' | 'error' | 'ok'; children: ReactNode }) {
  return (
    <p className={`mw-notice mw-notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </p>
  );
}
