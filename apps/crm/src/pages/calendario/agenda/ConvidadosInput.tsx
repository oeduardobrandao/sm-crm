import {
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
  type Ref,
} from 'react';
import { X } from 'lucide-react';
import type { AgendaConvidadoInput } from '@/store/agenda';
import { emailConvidadoValido, MAX_CONVIDADOS } from './eventoFormSchema';

/** What the form calls before submitting (see `controleRef`). */
export interface ConvidadosInputControle {
  /** Commits the text still in the field. `true` when nothing is left (empty, or
   *  every address became a chip); `false` when an invalid address stays, in which
   *  case the inline message shows and the field takes focus. */
  comitarPendente: () => boolean;
}

interface ConvidadosInputProps {
  value: AgendaConvidadoInput[];
  onChange: (convidados: AgendaConvidadoInput[]) => void;
  max?: number;
  disabled?: boolean;
  /** Lets the form commit the pending text on submit (a click on Salvar does not
   *  always blur the field first, and Enter in another field never does). */
  controleRef?: Ref<ConvidadosInputControle>;
  /** `true` while an invalid address waits in the field; `false` again on unmount. */
  onInvalidoChange?: (invalido: boolean) => void;
  /** Set by FormControl so the FormLabel points at the text field. */
  id?: string;
  'aria-describedby'?: string;
}

/** Characters that end an e-mail while typing or pasting. */
const SEPARADORES = /[\s,;]+/;

const MENSAGEM_INVALIDO = 'Informe um e-mail válido.';

/** External guests as e-mail chips. A chip is committed on Enter, comma, space (typed or
 *  pasted) and blur; an invalid address stays in the field with an inline message. */
export function ConvidadosInput({
  value,
  onChange,
  max = MAX_CONVIDADOS,
  disabled,
  controleRef,
  onInvalidoChange,
  id,
  'aria-describedby': describedBy,
}: ConvidadosInputProps) {
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const erroId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const cheio = value.length >= max;

  /** Commits every complete token of `bruto`; returns the unconsumed rest (an invalid
   *  address and anything after it). Duplicates are dropped silently. */
  const comitar = (bruto: string): string => {
    const fichas = bruto.split(SEPARADORES).filter(Boolean);
    const atuais = [...value];
    const vistos = new Set(atuais.map((c) => c.email));
    let resto = '';
    let mensagem: string | null = null;
    for (let i = 0; i < fichas.length; i++) {
      const email = fichas[i].toLowerCase();
      if (vistos.has(email)) continue;
      if (atuais.length >= max) break;
      if (!emailConvidadoValido(email)) {
        mensagem = MENSAGEM_INVALIDO;
        resto = fichas.slice(i).join(' ');
        break;
      }
      vistos.add(email);
      atuais.push({ email, nome: null });
    }
    if (atuais.length !== value.length) onChange(atuais);
    setErro(mensagem);
    return resto;
  };

  // No deps: the handle must see the current text and chips.
  useImperativeHandle(controleRef, () => ({
    comitarPendente: () => {
      if (!texto.trim()) return true;
      const resto = comitar(texto);
      setTexto(resto);
      if (resto === '') return true;
      inputRef.current?.focus();
      return false;
    },
  }));

  const invalido = erro !== null;
  useEffect(() => {
    onInvalidoChange?.(invalido);
  }, [invalido, onInvalidoChange]);
  // Hidden (Privado on) or closed: never leave the form blocked by a field it no longer shows.
  useEffect(() => () => onInvalidoChange?.(false), [onInvalidoChange]);

  const aoDigitar = (e: ChangeEvent<HTMLInputElement>) => {
    const bruto = e.target.value;
    setErro(null);
    // A trailing separator (typed, or inside a paste) closes the token; without one
    // the user is still typing, so a half-typed address is never flagged.
    if (SEPARADORES.test(bruto)) {
      setTexto(comitar(bruto));
    } else {
      setTexto(bruto);
    }
  };

  // A text input flattens line breaks on paste, which would glue a pasted column of
  // addresses together: take over any multi-address paste.
  const aoColar = (e: ClipboardEvent<HTMLInputElement>) => {
    const colado = e.clipboardData.getData('text');
    if (!SEPARADORES.test(colado.trim())) return;
    e.preventDefault();
    setErro(null);
    setTexto(comitar(`${texto} ${colado}`));
  };

  const aoTeclar = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      // Never submit the surrounding form from here.
      e.preventDefault();
      if (texto.trim()) setTexto(comitar(texto));
    } else if (e.key === 'Backspace' && texto === '' && value.length > 0) {
      onChange(value.slice(0, -1));
      setErro(null);
    }
  };

  const aoSair = () => {
    if (texto.trim()) setTexto(comitar(texto));
  };

  const remover = (email: string) => {
    onChange(value.filter((c) => c.email !== email));
    setErro(null);
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="flex min-h-[44px] flex-wrap items-center gap-1.5 rounded-[10px] border px-2 py-1.5"
        style={{
          borderColor: erro ? 'var(--danger)' : 'var(--border-color)',
          background: 'var(--card-bg)',
        }}
      >
        {value.map((c) => (
          <span
            key={c.email}
            className="inline-flex h-[30px] max-w-full items-center gap-1.5 rounded-full pl-3 pr-2 text-[13px]"
            style={{ background: 'var(--surface-2)' }}
          >
            <span className="min-w-0 truncate" title={c.nome ? c.email : undefined}>
              {c.nome || c.email}
            </span>
            <button
              type="button"
              aria-label={`Remover ${c.email}`}
              disabled={disabled}
              onClick={() => remover(c.email)}
              className="rounded px-0.5"
              style={{ color: 'var(--text-muted)' }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        ))}
        {!cheio && (
          <input
            ref={inputRef}
            id={id}
            type="text"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-label="E-mail do convidado"
            aria-invalid={erro ? true : undefined}
            aria-describedby={erro ? `${erroId} ${describedBy ?? ''}`.trim() : describedBy}
            placeholder={value.length === 0 ? 'nome@empresa.com' : ''}
            disabled={disabled}
            value={texto}
            onChange={aoDigitar}
            onKeyDown={aoTeclar}
            onPaste={aoColar}
            onBlur={aoSair}
            className="h-[30px] min-w-[160px] flex-1 border-0 bg-transparent px-1.5 text-sm outline-none"
          />
        )}
      </div>
      <div className="flex items-start justify-between gap-3">
        <p
          id={erroId}
          role={erro ? 'alert' : undefined}
          className="m-0 text-xs"
          style={{ color: 'var(--danger-text)' }}
        >
          {erro}
        </p>
        <span className="shrink-0 text-xs" style={{ color: 'var(--text-muted)' }}>
          {value.length} de {max}
        </span>
      </div>
    </div>
  );
}
