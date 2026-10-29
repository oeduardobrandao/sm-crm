// Saved draft → "Enviar para aprovação" → inline confirmation → result (spec §5, board 2).
// Only a click on "Enviar ao cliente" calls send_post_to_client; the nonce comes from the
// save result's _meta and never from the model.
import { useState } from 'react';
import { CheckCircle2, ExternalLink, Send } from 'lucide-react';
import type { Host } from '../bridge';
import type { ClientRef, SendOutcome, Tipo } from '../types';
import {
  Button,
  CALL_FAILED,
  Card,
  LINK_FAILED,
  Notice,
  StatusChip,
  TIPO_LABEL,
  errorMessage,
  plural,
  postUrl,
} from '../ui';

/** Statuses send_post_to_client accepts as expected_status (plan Task 6). */
const SENDABLE = new Set(['rascunho', 'revisao_interna', 'correcao_cliente', 'aprovado_interno']);

export const OUTCOME_MESSAGE: Record<SendOutcome, string> = {
  sent: 'Post enviado ao cliente para aprovação.',
  already_sent: 'Este post já está com o cliente.',
  approved: 'O cliente já aprovou este post.',
  failed: 'A publicação deste post falhou. Resolva no Mesaas antes de enviar de novo.',
  stale: 'O post mudou no Mesaas. Atualize o cartão.',
};

/** Start of send_post_to_client's expired-nonce sentence (send.ts EXPIRED_CARD). */
const EXPIRED_CARD = /^Este cartão expirou\./;

const OUTCOME_STATUS: Partial<Record<SendOutcome, string>> = {
  sent: 'enviado_cliente',
  already_sent: 'enviado_cliente',
  approved: 'aprovado_cliente',
};

export interface SavedPost {
  id: number;
  titulo: string;
  tipo: Tipo;
  status: string;
}

type Phase = 'saved' | 'confirm' | 'sending' | 'done';

export function SendFlow({
  host,
  post,
  client,
  slideCount,
  nonce,
  savedNotice,
}: {
  host: Host;
  post: SavedPost;
  client: ClientRef;
  slideCount?: number;
  nonce?: string;
  savedNotice?: string;
}) {
  const [phase, setPhase] = useState<Phase>('saved');
  const [status, setStatus] = useState(post.status);
  const [message, setMessage] = useState<{ tone: 'ok' | 'info' | 'error'; text: string }>();
  const [sentAt, setSentAt] = useState<Date>();

  const canSend = !!nonce && SENDABLE.has(status) && phase !== 'done';
  const details = [
    client.nome,
    TIPO_LABEL[post.tipo] ?? post.tipo,
    slideCount && post.tipo === 'carrossel' ? plural(slideCount, 'lâmina', 'lâminas') : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const open = async () => {
    try {
      await host.openLink(postUrl(post.id));
    } catch {
      setMessage({ tone: 'error', text: LINK_FAILED });
    }
  };

  const send = async () => {
    setPhase('sending');
    setMessage(undefined);
    try {
      const r = await host.callTool('send_post_to_client', {
        post_id: post.id,
        expected_status: status,
        nonce,
      });
      const sc = r.structuredContent as { card?: string; outcome?: SendOutcome } | undefined;
      if (r.isError || !sc?.outcome || !(sc.outcome in OUTCOME_MESSAGE)) {
        const text = errorMessage(r);
        // An expired card cannot send again (the nonce is dead until a new save); any other
        // refusal (a video without cover, a failed call) keeps the button for a retry.
        setPhase(EXPIRED_CARD.test(text) ? 'done' : 'saved');
        setMessage({ tone: 'error', text });
        return;
      }
      const next = OUTCOME_STATUS[sc.outcome];
      if (next) setStatus(next);
      if (sc.outcome === 'sent') setSentAt(new Date());
      setPhase('done');
      setMessage({
        tone: sc.outcome === 'sent' ? 'ok' : 'info',
        text: OUTCOME_MESSAGE[sc.outcome],
      });
    } catch {
      setPhase('saved');
      setMessage({ tone: 'error', text: CALL_FAILED });
    }
  };

  if (phase === 'confirm' || phase === 'sending') {
    const what =
      post.tipo === 'carrossel' && slideCount
        ? `${plural(slideCount, 'lâmina', 'lâminas')} e a legenda.`
        : 'O post e a legenda.';
    return (
      <Card
        label="Confirmar envio ao cliente"
        title={`Enviar para ${client.nome} aprovar?`}
        footer={
          <>
            <Button busy={phase === 'sending'} onClick={send}>
              <Send size={14} aria-hidden="true" />
              Enviar ao cliente
            </Button>
            <Button
              variant="ghost"
              disabled={phase === 'sending'}
              onClick={() => setPhase('saved')}
            >
              Cancelar
            </Button>
          </>
        }
      >
        <dl className="mw-dl">
          <dt>Como chega</dt>
          <dd>No Hub do cliente e por e-mail</dd>
          <dt>O que o cliente vê</dt>
          <dd>{what}</dd>
          <dt>Depois</dt>
          <dd>O cliente aprova ou pede correção. Nada é publicado agora.</dd>
        </dl>
        <span className="mw-hint">
          Só o clique de uma pessoa envia. O chat sozinho não envia nem publica.
        </span>
      </Card>
    );
  }

  const subtitle =
    sentAt && status === 'enviado_cliente'
      ? `Enviado hoje às ${sentAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
      : details;

  return (
    <Card
      label={phase === 'done' ? 'Resultado do envio' : 'Rascunho salvo'}
      title={post.titulo}
      subtitle={subtitle}
      aside={<StatusChip status={status} />}
      footer={
        <>
          {canSend ? (
            <Button onClick={() => setPhase('confirm')}>
              <Send size={14} aria-hidden="true" />
              Enviar para aprovação
            </Button>
          ) : null}
          <Button variant="outline" onClick={open}>
            <ExternalLink size={14} aria-hidden="true" />
            Abrir no Mesaas
          </Button>
        </>
      }
    >
      {savedNotice && phase === 'saved' && !message ? (
        <Notice tone="ok">
          <CheckCircle2 size={14} aria-hidden="true" /> {savedNotice}
        </Notice>
      ) : null}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {!nonce && phase === 'saved' ? (
        <span className="mw-hint">Para enviar ao cliente, abra o post no Mesaas.</span>
      ) : null}
    </Card>
  );
}

/** A bare send_result (a host that renders the widget-only tool's own result). */
export function SendResult({
  host,
  data,
}: {
  host: Host;
  data: { post_id: number; outcome: SendOutcome };
}) {
  const [err, setErr] = useState<string>();
  return (
    <Card
      label="Resultado do envio"
      title={OUTCOME_MESSAGE[data.outcome]}
      aside={
        OUTCOME_STATUS[data.outcome] ? <StatusChip status={OUTCOME_STATUS[data.outcome]!} /> : null
      }
      footer={
        <Button
          variant="outline"
          onClick={() => host.openLink(postUrl(data.post_id)).catch(() => setErr(LINK_FAILED))}
        >
          <ExternalLink size={14} aria-hidden="true" />
          Abrir no Mesaas
        </Button>
      }
    >
      {err ? <Notice tone="error">{err}</Notice> : null}
    </Card>
  );
}
