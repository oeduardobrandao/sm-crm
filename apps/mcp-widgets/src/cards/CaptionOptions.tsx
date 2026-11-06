// Opções de legenda (board 3). With a post_id the pick is saved with update_post;
// without one it goes back to the chat so the model re-renders the preview with it.
import { useState } from 'react';
import { Check, RefreshCw } from 'lucide-react';
import type { Host } from '../bridge';
import type { CaptionOptionsData } from '../types';
import {
  Button,
  CALL_FAILED,
  Card,
  MESSAGE_FAILED,
  Notice,
  errorMessage,
  fmtInt,
  plural,
} from '../ui';

function optionTitle(label: string, i: number): string {
  const n = `Opção ${i + 1}`;
  return /^op[cç][aã]o\s*\d/i.test(label.trim()) ? label : `${n} · ${label}`;
}

export function CaptionOptions({ host, data }: { host: Host; data: CaptionOptionsData }) {
  const options = Array.isArray(data.options) ? data.options : [];
  const [picked, setPicked] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string }>();

  const choice = options[picked];
  const choiceLen = choice ? (typeof choice.len === 'number' ? choice.len : choice.text.length) : 0;
  const over = choiceLen > data.caption_max;
  const hasPost = data.post_id != null;

  const use = async () => {
    if (!choice) return;
    setMsg(undefined);
    if (!hasPost) {
      try {
        await host.sendMessage(`Usar a opção ${picked + 1}`);
      } catch {
        setMsg({ tone: 'error', text: MESSAGE_FAILED });
      }
      return;
    }
    setBusy(true);
    try {
      const r = await host.callTool('update_post', {
        post_id: data.post_id,
        ig_caption: choice.text,
      });
      setMsg(
        r.isError
          ? { tone: 'error', text: errorMessage(r) }
          : { tone: 'ok', text: `Legenda da opção ${picked + 1} salva no post.` },
      );
    } catch {
      setMsg({ tone: 'error', text: CALL_FAILED });
    } finally {
      setBusy(false);
    }
  };

  const more = () =>
    host
      .sendMessage('Gerar outras opções de legenda')
      .catch(() => setMsg({ tone: 'error', text: MESSAGE_FAILED }));

  return (
    <Card
      label="Opções de legenda do Mesaas"
      title="Opções de legenda"
      subtitle={data.client.nome}
      footer={
        <>
          <Button busy={busy} disabled={over || !choice} onClick={use}>
            <Check size={14} aria-hidden="true" />
            Usar esta legenda
          </Button>
          <Button variant="ghost" onClick={more}>
            <RefreshCw size={14} aria-hidden="true" />
            Gerar outras
          </Button>
          <span className="mw-hint">
            {hasPost
              ? 'Salva no post em rascunho. Substitui a legenda atual.'
              : 'A opção escolhida volta para o chat e entra na prévia.'}
          </span>
        </>
      }
    >
      <div className="mw-options" role="group" aria-label="Opções de legenda">
        {options.map((o, i) => {
          const len = typeof o.len === 'number' ? o.len : o.text.length;
          const optOver = len > data.caption_max;
          return (
            <button
              key={i}
              type="button"
              className="mw-option"
              aria-pressed={i === picked}
              onClick={() => setPicked(i)}
            >
              <span className="mw-row">
                <strong className="mw-label">{optionTitle(o.label, i)}</strong>
                <span className={optOver ? 'mw-count mw-count-over' : 'mw-count'}>
                  {plural(len, 'caractere', 'caracteres')}
                </span>
              </span>
              <span className="mw-caption">{o.text}</span>
            </button>
          );
        })}
      </div>
      {over ? (
        <Notice tone="error">
          Legenda acima do limite de {fmtInt(data.caption_max)} caracteres. Escolha outra opção ou
          peça uma versão mais curta.
        </Notice>
      ) : null}
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
    </Card>
  );
}
