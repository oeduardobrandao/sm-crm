// Anexar imagem do chat (board 5, ChatGPT). Picking a slide that already has an image asks
// before replacing; an empty slot appends. Ineligible posts show the server's reason only.
// After a success the card shows the attached image (the signed URL the tool returns, on the
// media origin the resource CSP allows): in its slot and next to the confirmation.
import { useState } from 'react';
import { CheckCircle2, ImagePlus, Images, Replace } from 'lucide-react';
import type { Host, PickedImage } from '../bridge';
import type { AttachImageData } from '../types';
import { AttachImages } from './AttachImages';
import {
  Button,
  CALL_FAILED,
  Card,
  MESSAGE_FAILED,
  Notice,
  STATUS_LABEL,
  TIPO_LABEL,
  TipoBadge,
  errorMessage,
  freshImage,
  resultJson,
} from '../ui';

type Slide = { url?: string; fresh?: boolean; link_id?: number };

export function AttachImage({ host, data }: { host: Host; data: AttachImageData }) {
  // Two or more chat images: the multi-image card (one confirmation, attached in order).
  if (Array.isArray(data.images) && data.images.length > 1)
    return <AttachImages host={host} data={data} />;
  return <AttachOne host={host} data={data} />;
}

function AttachOne({ host, data }: { host: Host; data: AttachImageData }) {
  const [media, setMedia] = useState<Slide[]>(() =>
    (Array.isArray(data.media) ? data.media : [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((m) => ({ url: m.url, link_id: m.link_id })),
  );
  const max = data.max || 10;
  const room = media.length < max;
  const slots = media.length + (room ? 1 : 0);
  const initial =
    data.position && data.position >= 1 && data.position <= slots
      ? data.position
      : room
        ? media.length + 1
        : 1;

  const [picked, setPicked] = useState(initial);
  const [image, setImage] = useState<PickedImage>(data.image);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string }>();
  const [done, setDone] = useState(false);
  const [attachedUrl, setAttachedUrl] = useState<string>();

  const hasImage = (n: number) => n <= media.length;
  const pickedHas = hasImage(picked);

  const attach = async (replace: boolean) => {
    setBusy(true);
    setMsg(undefined);
    // What this card saw, so the server refuses instead of acting on a post that changed since. Only
    // when the server sent link ids (older servers did not, and then the plain attach runs).
    const known = media.every((m) => typeof m.link_id === 'number');
    const expect = !known
      ? {}
      : replace
        ? { expected_link_id: media[picked - 1]?.link_id }
        : { expected_count: media.length };
    try {
      const r = await host.callTool('attach_image_to_post', {
        post_id: data.post.id,
        image: await freshImage(host, image),
        position: picked,
        replace,
        ...expect,
      });
      if (r.isError) {
        setMsg({ tone: 'error', text: errorMessage(r) });
      } else {
        const res = resultJson(r);
        const url = res?.url;
        const linkId = replace ? media[picked - 1]?.link_id : res?.link_id;
        const fresh: Slide = {
          url: typeof url === 'string' ? url : undefined,
          fresh: true,
          link_id: typeof linkId === 'number' ? linkId : undefined,
        };
        setMedia((prev) => {
          const next = prev.map((m): Slide => ({ ...m, fresh: false }));
          if (replace) next[picked - 1] = fresh;
          else next.splice(picked - 1, 0, fresh);
          return next;
        });
        setAttachedUrl(fresh.url);
        setDone(true);
        setMsg({
          tone: 'ok',
          text: replace
            ? `Imagem do slide ${picked} substituída no Mesaas.`
            : `Imagem anexada no slide ${picked} no Mesaas.`,
        });
      }
    } catch {
      setMsg({ tone: 'error', text: CALL_FAILED });
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  // After a success this image is in the post; another attach needs another image
  // (the local media list is stale, so a second click would duplicate it).
  const onAttach = () => {
    if (done) return;
    if (pickedHas) setConfirming(true);
    else void attach(false);
  };

  const chooseOther = async () => {
    if (!host.pickImage) return;
    try {
      const next = await host.pickImage();
      if (next) {
        setImage(next);
        setDone(false);
        setAttachedUrl(undefined);
        setMsg(undefined);
      }
    } catch {
      setMsg({ tone: 'error', text: CALL_FAILED });
    }
  };

  const otherPost = () =>
    host
      .sendMessage('Quero anexar esta imagem em outro post')
      .catch(() => setMsg({ tone: 'error', text: MESSAGE_FAILED }));

  const subtitle = [
    data.client.nome,
    TIPO_LABEL[data.post.tipo] ?? data.post.tipo,
    STATUS_LABEL[data.post.status] ?? data.post.status,
  ].join(' · ');

  if (!data.eligible) {
    return (
      <Card
        label="Anexar imagem no Mesaas"
        title={`Anexar ao post "${data.post.titulo}"`}
        subtitle={subtitle}
        aside={<TipoBadge tipo={data.post.tipo} />}
        footer={
          <Button variant="ghost" onClick={otherPost}>
            Outro post
          </Button>
        }
      >
        <Notice tone="error">{data.reason || 'Este post não pode receber imagens agora.'}</Notice>
        {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      </Card>
    );
  }

  const summary = pickedHas
    ? `O slide ${picked} já tem imagem: o card pergunta antes de substituir. Os outros ficam como estão.`
    : `A imagem entra no slide ${picked}. Os outros ficam como estão e nada é publicado.`;

  return (
    <Card
      label="Anexar imagem no Mesaas"
      title={`Anexar ao post "${data.post.titulo}"`}
      subtitle={subtitle}
      aside={<TipoBadge tipo={data.post.tipo} />}
      footer={
        confirming ? (
          <>
            <Button busy={busy} onClick={() => attach(true)}>
              <Replace size={14} aria-hidden="true" />
              Substituir
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
          </>
        ) : (
          <>
            <Button busy={busy} disabled={done} onClick={onAttach}>
              <ImagePlus size={14} aria-hidden="true" />
              Anexar no slide escolhido
            </Button>
            {host.pickImage ? (
              <Button variant="outline" onClick={chooseOther}>
                <Images size={14} aria-hidden="true" />
                Escolher outra imagem
              </Button>
            ) : null}
            <Button variant="ghost" onClick={otherPost}>
              Outro post
            </Button>
          </>
        )
      }
    >
      <strong className="mw-label">Em qual slide?</strong>
      <div className="mw-slots" role="group" aria-label="Slides do post">
        {Array.from({ length: slots }, (_, i) => {
          const n = i + 1;
          const has = hasImage(n);
          const slide = has ? media[i] : undefined;
          const url = slide?.url;
          const cls = ['mw-slot', has && 'mw-slot-filled', slide?.fresh && 'mw-slot-fresh']
            .filter(Boolean)
            .join(' ');
          return (
            <button
              key={n}
              type="button"
              className={cls}
              aria-pressed={n === picked}
              aria-label={`Slide ${n}${has ? ', já tem imagem' : ', vazia'}`}
              disabled={busy || confirming || done}
              onClick={() => {
                setPicked(n);
                setMsg(undefined);
              }}
            >
              {url ? <img src={url} alt="" loading="lazy" /> : null}
              <span className="mw-slot-n">{n}</span>
              <span className="mw-slot-hint">
                {slide?.fresh ? 'Anexada agora' : has ? 'Com imagem' : 'Vazia'}
              </span>
            </button>
          );
        })}
      </div>
      {confirming ? (
        <Notice tone="info">{`Substituir a imagem do slide ${picked}?`}</Notice>
      ) : done ? null : (
        <span className="mw-hint">{summary}</span>
      )}
      {msg?.tone === 'ok' ? (
        <div className="mw-attached" role="status">
          {attachedUrl ? <img src={attachedUrl} alt={`Imagem anexada no slide ${picked}`} /> : null}
          <p className="mw-attached-text">
            <CheckCircle2 size={16} aria-hidden="true" />
            {msg.text}
          </p>
        </div>
      ) : msg ? (
        <Notice tone={msg.tone}>{msg.text}</Notice>
      ) : null}
    </Card>
  );
}
