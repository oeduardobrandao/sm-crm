// Anexar várias imagens do chat (spec docs/superpowers/specs/2026-10-29-mcp-attach-multi-images-design.md).
// The person orders the images, picks append or replace, and confirms once; the card then calls
// attach_image_to_post one image at a time, in order, telling the server what it expected to find so a
// retry or a CRM edit in the meantime can never duplicate or overwrite the wrong slide. It stops at
// the first failure (the next images wait, so the order holds) and "Tentar de novo" resumes there.
import { useMemo, useState, type ReactNode } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ImagePlus,
  RotateCw,
  Repeat,
} from 'lucide-react';
import type { Host } from '../bridge';
import type { AttachImageData, ChatImage } from '../types';
import {
  Button,
  CALL_FAILED,
  Card,
  LINK_FAILED,
  MESSAGE_FAILED,
  Notice,
  STATUS_LABEL,
  TIPO_LABEL,
  TipoBadge,
  errorMessage,
  freshImage,
  postUrl,
  resultJson,
} from '../ui';

type Mode = 'append' | 'replace';
type Phase = 'idle' | 'running' | 'failed' | 'done';

interface Step {
  image: ChatImage;
  position: number;
  replace: boolean;
  expected_count?: number;
  expected_link_id?: number;
  trim_after: boolean;
}

/** What each image does, frozen when the person confirms. Exported for the tests. */
export function planSteps(
  images: ChatImage[],
  media: AttachImageData['media'],
  mode: Mode,
): Step[] {
  const n = media.length;
  const k = images.length;
  return images.map((image, j) => {
    if (mode === 'append') {
      return {
        image,
        position: n + 1 + j,
        replace: false,
        expected_count: n + j,
        trim_after: false,
      };
    }
    if (j < n) {
      return {
        image,
        position: j + 1,
        replace: true,
        expected_link_id: media[j].link_id,
        trim_after: j === k - 1 && k < n,
      };
    }
    // Replace mode, more images than slides: the rest are appended after the replaced ones.
    return { image, position: j + 1, replace: false, expected_count: j, trim_after: false };
  });
}

const ordinal = (n: number) => `${n}ª`;

export function AttachImages({ host, data }: { host: Host; data: AttachImageData }) {
  const images = data.images ?? [data.image];
  const media = useMemo(
    () =>
      (Array.isArray(data.media) ? data.media : []).slice().sort((a, b) => a.position - b.position),
    [data.media],
  );
  const max = data.max || 10;
  const n = media.length;
  const k = images.length;
  // Replace needs every current slide's link id (older servers send none).
  const canReplace = n > 0 && media.every((m) => typeof m.link_id === 'number');

  const [order, setOrder] = useState(() => images.map((_, i) => i));
  const [mode, setMode] = useState<Mode>('append');
  const [phase, setPhase] = useState<Phase>('idle');
  const [plan, setPlan] = useState<Step[]>([]);
  const [doneUrls, setDoneUrls] = useState<(string | undefined)[]>([]);
  const [current, setCurrent] = useState(0);
  const [failure, setFailure] = useState<string>();
  const [msg, setMsg] = useState<string>();

  const ordered = order.map((i) => images[i]);
  const overLimit = mode === 'append' && n + k > max;

  const move = (from: number, to: number) =>
    setOrder((o) => {
      const next = o.slice();
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });

  const run = async (steps: Step[], from: number) => {
    setPhase('running');
    setFailure(undefined);
    for (let j = from; j < steps.length; j++) {
      setCurrent(j);
      const s = steps[j];
      try {
        const r = await host.callTool('attach_image_to_post', {
          post_id: data.post.id,
          image: await freshImage(host, s.image),
          position: s.position,
          replace: s.replace,
          ...(s.expected_count !== undefined ? { expected_count: s.expected_count } : {}),
          ...(s.expected_link_id !== undefined ? { expected_link_id: s.expected_link_id } : {}),
          ...(s.trim_after ? { trim_after: true } : {}),
        });
        if (r.isError) {
          setFailure(errorMessage(r));
          setPhase('failed');
          return;
        }
        const url = resultJson(r)?.url;
        setDoneUrls((d) => {
          const next = d.slice();
          next[j] = typeof url === 'string' ? url : undefined;
          return next;
        });
      } catch {
        setFailure(CALL_FAILED);
        setPhase('failed');
        return;
      }
    }
    setCurrent(steps.length);
    setPhase('done');
  };

  const start = () => {
    const steps = planSteps(ordered, media, mode);
    setPlan(steps);
    setDoneUrls([]);
    void run(steps, 0);
  };

  const otherPost = () =>
    host
      .sendMessage('Quero anexar estas imagens em outro post')
      .catch(() => setMsg(MESSAGE_FAILED));
  const openPost = () => host.openLink(postUrl(data.post.id)).catch(() => setMsg(LINK_FAILED));

  const subtitle = [
    data.client?.nome,
    TIPO_LABEL[data.post.tipo] ?? data.post.tipo,
    STATUS_LABEL[data.post.status] ?? data.post.status,
  ]
    .filter(Boolean)
    .join(' · ');
  const shell = (body: ReactNode, footer: ReactNode) => (
    <Card
      label="Anexar imagens no Mesaas"
      title={`Anexar ao post "${data.post.titulo}"`}
      subtitle={subtitle}
      aside={<TipoBadge tipo={data.post.tipo} />}
      footer={footer}
    >
      {body}
      {msg ? <Notice tone="error">{msg}</Notice> : null}
    </Card>
  );

  if (!data.eligible) {
    return shell(
      <Notice tone="error">{data.reason || 'Este post não pode receber imagens agora.'}</Notice>,
      <Button variant="ghost" onClick={otherPost}>
        Outro post
      </Button>,
    );
  }

  const firstPos = plan[0]?.position ?? 0;
  const lastPos = plan[plan.length - 1]?.position ?? 0;

  if (phase === 'done') {
    const newUrls = plan.map((_, j) => doneUrls[j]);
    const slides: { url?: string; fresh: boolean }[] =
      mode === 'append'
        ? [
            ...media.map((m) => ({ url: m.url, fresh: false })),
            ...newUrls.map((url) => ({ url, fresh: true })),
          ]
        : newUrls.map((url) => ({ url, fresh: true }));
    return shell(
      <>
        <div className="mw-attached mw-attached-big" role="status">
          <p className="mw-attached-text">
            <CheckCircle2 size={18} aria-hidden="true" />
            {`${k} imagens anexadas no Mesaas, nos slides ${firstPos} a ${lastPos}.`}
          </p>
        </div>
        <strong className="mw-label">
          Como o post ficou <span className="mw-muted-inline">· {slides.length} slides</span>
        </strong>
        <ol className="mw-multi-final" aria-label="Slides do post">
          {slides.map((s, i) => (
            <li key={i} className={s.fresh ? 'mw-mthumb mw-mthumb-fresh' : 'mw-mthumb'}>
              {s.url ? <img src={s.url} alt="" loading="lazy" /> : null}
              <span className="mw-mthumb-n">{i + 1}</span>
              {s.fresh ? <span className="mw-mthumb-tag">Nova</span> : null}
            </li>
          ))}
        </ol>
        <span className="mw-hint">Nada foi publicado. O post continua em rascunho.</span>
      </>,
      <>
        <Button variant="outline" onClick={openPost}>
          Abrir no Mesaas
          <ExternalLink size={14} aria-hidden="true" />
        </Button>
        <Button variant="ghost" onClick={otherPost}>
          Outro post
        </Button>
      </>,
    );
  }

  if (phase === 'running' || phase === 'failed') {
    const doneCount = current;
    const status = (j: number) =>
      j < current
        ? 'done'
        : j === current
          ? phase === 'failed'
            ? 'failed'
            : 'sending'
          : 'waiting';
    return shell(
      <>
        {phase === 'running' ? (
          <div className="mw-progress" role="status">
            <div className="mw-progress-head">
              <strong>{`Anexando ${current + 1} de ${k}…`}</strong>
              <span className="mw-muted-inline">{`slides ${firstPos} a ${lastPos}`}</span>
            </div>
            <div className="mw-progress-bar">
              <span style={{ width: `${Math.round((current / k) * 100)}%` }} />
            </div>
          </div>
        ) : (
          <div className="mw-notice mw-notice-error mw-fail" role="alert">
            <strong>{`${doneCount} de ${k} imagens anexadas. A ${ordinal(current + 1)} não entrou.`}</strong>
            <span>{failure}</span>
            {current + 1 < k ? (
              <span>As imagens seguintes esperam, para não mudar a ordem.</span>
            ) : null}
          </div>
        )}
        <ol className="mw-multi-grid" aria-label="Imagens do chat">
          {plan.map((s, j) => {
            const st = status(j);
            return (
              <li key={j} className={`mw-mitem mw-mitem-${st}`}>
                <div className="mw-mthumb">
                  <img src={doneUrls[j] ?? s.image.download_url} alt="" loading="lazy" />
                </div>
                <span className="mw-mitem-label">
                  {st === 'done'
                    ? `Slide ${s.position} · anexada`
                    : st === 'sending'
                      ? `Slide ${s.position} · enviando`
                      : st === 'failed'
                        ? 'Não entrou'
                        : `Slide ${s.position}`}
                </span>
              </li>
            );
          })}
        </ol>
        {phase === 'running' ? (
          <span className="mw-hint">
            Cada imagem leva alguns segundos. Deixe esta conversa aberta até terminar.
          </span>
        ) : doneCount > 0 ? (
          <span className="mw-hint">{`As ${doneCount} anexadas já estão no post. Tentar de novo continua da ${ordinal(current + 1)} imagem, no slide ${plan[current].position}.`}</span>
        ) : null}
      </>,
      phase === 'running' ? (
        <Button busy>Anexando…</Button>
      ) : (
        <>
          <Button onClick={() => void run(plan, current)}>
            <RotateCw size={14} aria-hidden="true" />
            {`Tentar de novo (${k - current} ${k - current === 1 ? 'imagem' : 'imagens'})`}
          </Button>
          <Button variant="outline" onClick={openPost}>
            Abrir no Mesaas
          </Button>
        </>
      ),
    );
  }

  // Idle: the person orders the images and picks where they go.
  const slideOf = (j: number) => (mode === 'append' ? n + 1 + j : j + 1);
  return shell(
    <>
      {n > 0 ? (
        <>
          <strong className="mw-label">
            Slides atuais{' '}
            {mode === 'replace' ? (
              <span className="mw-danger-inline">· saem do post</span>
            ) : (
              <span className="mw-muted-inline">· {n}</span>
            )}
          </strong>
          <ol
            className={
              mode === 'replace' ? 'mw-multi-current mw-multi-leaving' : 'mw-multi-current'
            }
          >
            {media.map((m) => (
              <li key={m.position} className="mw-mthumb mw-mthumb-small">
                <img src={m.url} alt="" loading="lazy" />
                <span className="mw-mthumb-n">{m.position}</span>
              </li>
            ))}
          </ol>
        </>
      ) : null}
      <strong className="mw-label">
        Imagens do chat <span className="mw-muted-inline">· {k}, na ordem em que entram</span>
      </strong>
      <ol className="mw-multi-grid" aria-label="Imagens do chat">
        {ordered.map((img, j) => (
          <li key={order[j]} className="mw-mitem">
            <div className="mw-mthumb">
              <img src={img.download_url} alt="" loading="lazy" />
              <span className="mw-mthumb-n mw-mthumb-n-dark">{slideOf(j)}</span>
            </div>
            <div className="mw-arrows">
              <button
                type="button"
                className="mw-arrow"
                aria-label={`Mover a imagem do slide ${slideOf(j)} para a esquerda`}
                disabled={j === 0}
                onClick={() => move(j, j - 1)}
              >
                <ChevronLeft size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="mw-arrow"
                aria-label={`Mover a imagem do slide ${slideOf(j)} para a direita`}
                disabled={j === k - 1}
                onClick={() => move(j, j + 1)}
              >
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </div>
          </li>
        ))}
      </ol>
      {n > 0 ? (
        <fieldset className="mw-modes">
          <legend className="mw-label">Onde as imagens entram?</legend>
          <label className={mode === 'append' ? 'mw-mode mw-mode-on' : 'mw-mode'}>
            <input
              type="radio"
              name="mw-mode"
              checked={mode === 'append'}
              onChange={() => setMode('append')}
            />
            <span>
              <b>Depois dos slides atuais</b>
              <span className="mw-mode-hint">{`O post fica com ${n + k} slides.`}</span>
            </span>
          </label>
          {canReplace ? (
            <label className={mode === 'replace' ? 'mw-mode mw-mode-on' : 'mw-mode'}>
              <input
                type="radio"
                name="mw-mode"
                checked={mode === 'replace'}
                onChange={() => setMode('replace')}
              />
              <span>
                <b>Substituir os slides atuais</b>
                <span className="mw-mode-hint">{`${n === 1 ? 'O slide atual sai' : `Os ${n} slides atuais saem`} do post e ele fica com ${k}.`}</span>
              </span>
            </label>
          ) : null}
        </fieldset>
      ) : null}
      {overLimit ? (
        <Notice tone="error">
          {max - n > 0
            ? `O post aceita até ${max} slides. Escolha Substituir ou mande até ${max - n} imagens.`
            : `O post já tem ${max} slides. Escolha Substituir para trocar os atuais.`}
        </Notice>
      ) : (
        <span className="mw-hint">Nada é publicado. O post continua em rascunho.</span>
      )}
    </>,
    <>
      <Button disabled={overLimit} onClick={start}>
        {mode === 'replace' ? (
          <Repeat size={14} aria-hidden="true" />
        ) : (
          <ImagePlus size={14} aria-hidden="true" />
        )}
        {mode === 'replace' ? `Substituir por ${k} imagens` : `Anexar ${k} imagens`}
      </Button>
      <Button variant="ghost" onClick={otherPost}>
        Outro post
      </Button>
    </>,
  );
}
