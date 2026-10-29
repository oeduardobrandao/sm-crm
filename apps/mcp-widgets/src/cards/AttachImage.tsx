// Anexar imagem do chat (board 5, ChatGPT). Picking a slide that already has an image asks
// before replacing; an empty slot appends. Ineligible posts show the server's reason only.
import { useState } from 'react';
import { ImagePlus, Images, Replace } from 'lucide-react';
import type { Host, PickedImage } from '../bridge';
import type { AttachImageData } from '../types';
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
} from '../ui';

export function AttachImage({ host, data }: { host: Host; data: AttachImageData }) {
  const media = (Array.isArray(data.media) ? data.media : [])
    .slice()
    .sort((a, b) => a.position - b.position);
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

  const hasImage = (n: number) => n <= media.length;
  const pickedHas = hasImage(picked);

  const attach = async (replace: boolean) => {
    setBusy(true);
    setMsg(undefined);
    try {
      const r = await host.callTool('attach_image_to_post', {
        post_id: data.post.id,
        image,
        position: picked,
        replace,
      });
      if (r.isError) {
        setMsg({ tone: 'error', text: errorMessage(r) });
      } else {
        setDone(true);
        setMsg({
          tone: 'ok',
          text: replace
            ? `Imagem da lâmina ${picked} substituída no Mesaas.`
            : `Imagem anexada na lâmina ${picked} no Mesaas.`,
        });
      }
    } catch {
      setMsg({ tone: 'error', text: CALL_FAILED });
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  const onAttach = () => (pickedHas ? setConfirming(true) : attach(false));

  const chooseOther = async () => {
    if (!host.pickImage) return;
    try {
      const next = await host.pickImage();
      if (next) {
        setImage(next);
        setDone(false);
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
    ? `A lâmina ${picked} já tem imagem: o cartão pergunta antes de substituir. As outras ficam como estão.`
    : `A imagem entra na lâmina ${picked}. As outras ficam como estão e nada é publicado.`;

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
              Anexar na lâmina escolhida
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
      <strong className="mw-label">Em qual lâmina?</strong>
      <div className="mw-slots" role="group" aria-label="Lâminas do post">
        {Array.from({ length: slots }, (_, i) => {
          const n = i + 1;
          const has = hasImage(n);
          const url = has ? media[i].url : undefined;
          return (
            <button
              key={n}
              type="button"
              className={has ? 'mw-slot mw-slot-filled' : 'mw-slot'}
              aria-pressed={n === picked}
              aria-label={`Lâmina ${n}${has ? ', já tem imagem' : ', vazia'}`}
              disabled={busy || confirming}
              onClick={() => {
                setPicked(n);
                setDone(false);
                setMsg(undefined);
              }}
            >
              {url ? <img src={url} alt="" loading="lazy" /> : null}
              <span className="mw-slot-n">{n}</span>
              <span className="mw-slot-hint">{has ? 'Com imagem' : 'Vazia'}</span>
            </button>
          );
        })}
      </div>
      {confirming ? (
        <Notice tone="info">{`Substituir a imagem da lâmina ${picked}?`}</Notice>
      ) : (
        <span className="mw-hint">{summary}</span>
      )}
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
    </Card>
  );
}
