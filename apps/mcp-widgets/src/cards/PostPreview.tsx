// Prévia do post (board 1, phone board 6). Read-only until "Salvar como rascunho":
// that click calls create_post (or update_post for a saved post) and hands over to SendFlow.
import { useId, useState } from 'react';
import { ExternalLink, ListChecks, Save } from 'lucide-react';
import type { Host } from '../bridge';
import { SEND_NONCE_META_KEY, type PreviewData, type Tipo } from '../types';
import {
  Button,
  CALL_FAILED,
  Card,
  LINK_FAILED,
  MESSAGE_FAILED,
  Notice,
  TipoBadge,
  clientUrl,
  errorMessage,
  fmtInt,
  postUrl,
  resultJson,
} from '../ui';
import { SendFlow, type SavedPost } from './SendFlow';

function firstLine(text: string, max = 60): string {
  const line = text.trim().split('\n')[0] ?? '';
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}...` : line;
}

export function PostPreview({ host, data }: { host: Host; data: PreviewData }) {
  const slides = Array.isArray(data.slides) ? data.slides : [];
  const [current, setCurrent] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState<{ post: SavedPost; nonce?: string }>();
  const countId = useId();

  const captionLen =
    typeof data.caption_len === 'number' ? data.caption_len : data.ig_caption.length;
  const over = captionLen > data.caption_max;
  const isNew = data.post_id == null;

  if (saved) {
    return (
      <SendFlow
        host={host}
        post={saved.post}
        client={data.client}
        slideCount={slides.length || undefined}
        nonce={saved.nonce}
        savedNotice={isNew ? 'Rascunho salvo no Mesaas.' : 'Alterações salvas no Mesaas.'}
      />
    );
  }

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const r = isNew
        ? await host.callTool('create_post', {
            cliente_id: data.client.id,
            titulo: data.titulo,
            tipo: data.tipo,
            body: data.body,
            ig_caption: data.ig_caption,
          })
        : // Never `tipo` (an echoed format would change the post) and never an empty
          // `body`: update_post reads a present "" as "clear the content".
          await host.callTool('update_post', {
            post_id: data.post_id,
            titulo: data.titulo,
            ig_caption: data.ig_caption,
            ...(data.body?.trim() ? { body: data.body } : {}),
          });
      const row = r.isError ? undefined : resultJson(r);
      if (!row || typeof row.id !== 'number') {
        setError(r.isError ? errorMessage(r) : CALL_FAILED);
        return;
      }
      const nonce = r._meta?.[SEND_NONCE_META_KEY];
      setSaved({
        post: {
          id: row.id,
          titulo: typeof row.titulo === 'string' ? row.titulo : data.titulo,
          tipo: (typeof row.tipo === 'string' ? row.tipo : data.tipo) as Tipo,
          status: typeof row.status === 'string' ? row.status : 'rascunho',
        },
        nonce: typeof nonce === 'string' ? nonce : undefined,
      });
    } catch {
      setError(CALL_FAILED);
    } finally {
      setBusy(false);
    }
  };

  const askOptions = () =>
    host
      .sendMessage(`Mostrar opções de legenda para o post "${data.titulo}"`)
      .catch(() => setError(MESSAGE_FAILED));

  const open = () =>
    host
      .openLink(isNew ? clientUrl(data.client.id) : postUrl(data.post_id!))
      .catch(() => setError(LINK_FAILED));

  const subtitle = [data.client.nome, data.pilar ? `pilar ${data.pilar}` : null]
    .filter(Boolean)
    .join(' · ');
  const slide = slides[current];

  return (
    <Card
      label="Prévia do post do Mesaas"
      title={data.titulo}
      subtitle={subtitle}
      aside={<TipoBadge tipo={data.tipo} />}
      footer={
        <>
          <Button
            busy={busy}
            disabled={over}
            onClick={save}
            aria-describedby={over ? countId : undefined}
          >
            <Save size={14} aria-hidden="true" />
            {isNew ? 'Salvar como rascunho' : 'Salvar alterações'}
          </Button>
          <Button variant="outline" onClick={askOptions}>
            <ListChecks size={14} aria-hidden="true" />
            Ver opções de legenda
          </Button>
          <Button variant="ghost" onClick={open}>
            <ExternalLink size={14} aria-hidden="true" />
            Abrir no Mesaas
          </Button>
        </>
      }
    >
      {slides.length > 0 ? (
        <div className="mw-slides">
          <div className="mw-slide-main" aria-live="polite">
            <span className="mw-slide-n">
              Lâmina {current + 1} de {slides.length}
            </span>
            <strong className="mw-slide-text">{slide?.texto}</strong>
          </div>
          <ol className="mw-slide-list" aria-label="Lâminas">
            {slides.map((s, i) => (
              <li key={i}>
                <button
                  type="button"
                  className="mw-slide-item"
                  aria-pressed={i === current}
                  onClick={() => setCurrent(i)}
                >
                  <span className="mw-slide-num">{i + 1}</span>
                  <span>{firstLine(s.texto)}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {data.roteiro ? (
        <div className="mw-roteiro">
          <strong className="mw-label">Roteiro</strong>
          {data.roteiro
            .split(/\n\s*\n|\n/)
            .map((p) => p.trim())
            .filter(Boolean)
            .map((p, i) => (
              <p key={i}>{p}</p>
            ))}
        </div>
      ) : null}

      <div className="mw-row">
        <strong className="mw-label">Legenda</strong>
        <span id={countId} className={over ? 'mw-count mw-count-over' : 'mw-count'}>
          {fmtInt(captionLen)} de {fmtInt(data.caption_max)} caracteres
        </span>
      </div>
      <p className={expanded ? 'mw-caption' : 'mw-caption mw-clamp'}>{data.ig_caption}</p>
      {data.ig_caption.length > 240 ? (
        <button type="button" className="mw-link" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Mostrar menos' : 'Mostrar a legenda inteira'}
        </button>
      ) : null}
      {over ? (
        <Notice tone="error">
          Legenda acima do limite. Peça uma versão com até {fmtInt(data.caption_max)} caracteres
          antes de salvar.
        </Notice>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <span className="mw-hint">
        {isNew
          ? 'Sem imagens ainda. Sem data: salvar não agenda nem publica.'
          : 'Salvar não agenda nem publica.'}
      </span>
    </Card>
  );
}
