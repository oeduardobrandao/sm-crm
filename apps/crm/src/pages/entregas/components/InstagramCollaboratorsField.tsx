import { useState, type ClipboardEvent, type KeyboardEvent, type Ref } from 'react';
import { AlertCircle, Users, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  COLLAB_ERROR_COPY,
  MAX_COLLABORATORS,
  parseCollaboratorInput,
  validateCollaborator,
} from '../collaborators';

interface InstagramCollaboratorsFieldProps {
  value: string[];
  /** Dispara uma vez por adição/remoção, com a lista completa resultante. */
  onChange: (next: string[]) => void;
  /** Agendado: chips sem remover, sem input, linha de bloqueio. Vence `trialOn`. */
  locked?: boolean;
  /** Reel de teste ligado: o campo inteiro fica desabilitado. */
  trialOn?: boolean;
  /** Usernames que o Instagram recusou (COLLABORATOR_INVALID). */
  refused?: string[];
  inputRef?: Ref<HTMLInputElement>;
  idPrefix: string;
}

/**
 * Campo de colaboradores do Instagram (tag input). Apresentacional: quem
 * monta decide se ele aparece (conta conectada, não-stories, mira Instagram).
 */
export function InstagramCollaboratorsField({
  value,
  onChange,
  locked = false,
  trialOn = false,
  refused = [],
  inputRef,
  idPrefix,
}: InstagramCollaboratorsFieldProps) {
  const { t } = useTranslation('postPanels');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const readOnly = locked;
  const disabled = !locked && trialOn;
  const atLimit = value.length >= MAX_COLLABORATORS;
  const showInput = !readOnly && !atLimit;

  /**
   * Adiciona os pedaços válidos de uma vez (um único onChange). Devolve o
   * primeiro pedaço recusado e o motivo; o limite só reporta erro quando nada
   * mais cabe e sobrou algo válido.
   */
  const addPieces = (pieces: string[]) => {
    const next = [...value];
    let firstError: { piece: string; problem: 'invalid' | 'duplicate'; message: string } | null =
      null;
    for (const piece of pieces) {
      const problem = validateCollaborator(piece, next);
      if (problem === null) {
        next.push(piece);
      } else if (problem !== 'limit' && !firstError) {
        firstError = { piece, problem, message: COLLAB_ERROR_COPY[problem](piece) };
      }
    }
    if (next.length > value.length) onChange(next);
    return firstError;
  };

  const commitDraft = (text: string) => {
    const pieces = parseCollaboratorInput(text);
    if (pieces.length === 0) {
      setDraft('');
      return;
    }
    const failure = addPieces(pieces);
    setError(failure ? failure.message : null);
    // Inválido fica no input para o usuário corrigir; o resto limpa.
    setDraft(failure?.problem === 'invalid' ? failure.piece : '');
  };

  const removeAt = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
    setError(null);
  };

  const handleChange = (text: string) => {
    setError(null);
    if (!/[\s,]/.test(text)) {
      setDraft(text);
      return;
    }
    // Vírgula ou espaço fecham o pedaço. O último trecho (sem separador depois)
    // continua sendo digitado.
    const parts = text.split(/[\s,]+/);
    const tail = parts.pop() ?? '';
    const failure = addPieces(parts.flatMap((p) => parseCollaboratorInput(p)));
    setError(failure ? failure.message : null);
    setDraft(tail);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitDraft(draft);
    } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      e.preventDefault();
      removeAt(value.length - 1);
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (!text) return;
    e.preventDefault();
    commitDraft(`${draft} ${text}`);
  };

  const refusedInValue = value.filter((u) => refused.includes(u));
  const refusedLine =
    refusedInValue.length === 0
      ? null
      : t('collaborators.refused', { count: refusedInValue.length });

  const statusLine = locked
    ? t('collaborators.locked')
    : trialOn
      ? t('collaborators.trial')
      : atLimit
        ? t('collaborators.limit')
        : t('collaborators.help');

  const inputId = `${idPrefix}-input`;
  const labelId = `${idPrefix}-label`;
  const errorId = `${idPrefix}-error`;
  const statusId = `${idPrefix}-status`;

  return (
    <div className="drawer-post-field drawer-post-field--collaborators">
      <div className="flex items-center justify-between gap-3">
        <span
          id={labelId}
          className="inline-flex items-center gap-1.5"
          style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--text-muted)' }}
        >
          <Users className="h-3.5 w-3.5" aria-hidden="true" />
          {t('collaborators.label')}
        </span>
        <span
          className="whitespace-nowrap text-xs"
          style={{ color: 'var(--text-light)', fontFamily: 'var(--font-mono)' }}
        >
          {t('collaborators.count', { n: value.length, max: MAX_COLLABORATORS })}
        </span>
      </div>

      <div
        role="group"
        aria-labelledby={labelId}
        className={`flex min-h-[40px] flex-wrap items-center gap-1.5 rounded-[10px] border bg-background px-2 py-1.5 focus-within:border-[hsl(var(--ring))]${
          disabled ? ' opacity-60' : ''
        }`}
        style={{ borderColor: 'var(--border-color)' }}
        onClick={(e) => e.currentTarget.querySelector('input')?.focus()}
      >
        {value.map((u, index) => {
          const isRefused = refused.includes(u);
          return (
            <span
              key={u}
              data-testid={`collab-chip-${u}`}
              data-refused={isRefused ? 'true' : undefined}
              className={`inline-flex h-7 items-center gap-1 rounded-full border text-[13px] ${
                readOnly ? 'px-2.5' : 'pl-2.5 pr-0.5'
              }`}
              style={
                isRefused
                  ? {
                      borderColor: 'var(--danger)',
                      color: 'var(--danger-text)',
                      background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
                    }
                  : {
                      borderColor: 'var(--border-color)',
                      color: 'var(--text-main)',
                      background: 'var(--surface-2)',
                    }
              }
            >
              {isRefused && <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}@{u}
              {!readOnly && (
                <button
                  type="button"
                  aria-label={t('collaborators.removeAria', { username: u })}
                  disabled={disabled}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeAt(index);
                  }}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-black/10 disabled:cursor-not-allowed"
                  style={{ color: 'inherit' }}
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </span>
          );
        })}
        {showInput && (
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            value={draft}
            disabled={disabled}
            placeholder={t('collaborators.placeholder')}
            aria-labelledby={labelId}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${errorId} ${statusId}` : statusId}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
            className="min-w-[8rem] flex-1 border-0 bg-transparent px-1 py-0.5 text-base outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed md:text-sm"
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onBlur={() => {
              if (draft.trim()) commitDraft(draft);
            }}
          />
        )}
      </div>

      {error && (
        <p id={errorId} role="alert" className="text-xs" style={{ color: 'var(--danger-text)' }}>
          {error}
        </p>
      )}
      {refusedLine && (
        <p className="text-xs" style={{ color: 'var(--danger-text)' }}>
          {refusedLine}
        </p>
      )}
      <p id={statusId} className="text-xs" style={{ color: 'var(--text-light)' }}>
        {statusLine}
      </p>
    </div>
  );
}
