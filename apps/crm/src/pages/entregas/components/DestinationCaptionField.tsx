import { forwardRef, useImperativeHandle } from 'react';
import { Copy, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { CommentThread } from '@/store';
import { useCaptionDraft } from './useCaptionDraft';

export interface DestinationCaptionFieldHandle {
  /** Texto atual, rascunho não salvo incluso (semente da legenda de outro destino). */
  getText(): string;
}

interface DestinationCaptionFieldProps {
  id: string;
  label: string;
  value: string;
  /** Limite do registro (captionMaxFor); null = sem limite (Geral). */
  max: number | null;
  placeholder: string;
  hint?: string;
  disabled?: boolean;
  lockedMessage?: string;
  /** Botão "Copiar legenda" (Geral). */
  showCopy?: boolean;
  /** Rejeita = falhou (quem chama mostra o toast); o rascunho fica e o próximo
   *  caractere tenta de novo (contrato de useCaptionDraft). */
  onSave: (text: string) => Promise<void>;
}

// Identidade estável: useCaptionDraft memoiza as âncoras pelas threads.
const NO_THREADS: CommentThread[] = [];

/**
 * Legenda de um destino que não é o Instagram (TikTok, Geral): sem comentários nem
 * âncoras, com o mesmo autosave serializado e o mesmo registro de trabalho não
 * salvo da legenda do Instagram (useCaptionDraft). Uma instância por post
 * (key={post.id} em quem monta), como InstagramCaptionField.
 */
export const DestinationCaptionField = forwardRef<
  DestinationCaptionFieldHandle,
  DestinationCaptionFieldProps
>(function DestinationCaptionField(
  { id, label, value, max, placeholder, hint, disabled, lockedMessage, showCopy, onSave },
  ref,
) {
  const { text, change, getText } = useCaptionDraft({
    value,
    threads: NO_THREADS,
    onSave: (t) => onSave(t),
    max,
  });
  useImperativeHandle(ref, () => ({ getText }), [getText]);

  const over = max != null && text.length > max;
  const copy = () => {
    navigator.clipboard.writeText(getText()).then(
      () => toast.success('Legenda copiada.'),
      () => toast.error('Não foi possível copiar a legenda.'),
    );
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <label
          htmlFor={id}
          className="whitespace-nowrap text-sm font-semibold"
          style={{ color: 'var(--text-main)' }}
        >
          {label}
        </label>
        {disabled && lockedMessage && (
          <Lock
            className="h-3.5 w-3.5"
            style={{ color: 'var(--text-light)' }}
            aria-label={lockedMessage}
          />
        )}
        {showCopy && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto mb-0 h-7 gap-1 px-2 text-xs"
            onClick={copy}
            disabled={!text}
          >
            <Copy className="h-3.5 w-3.5" />
            Copiar legenda
          </Button>
        )}
        <span
          className={showCopy ? 'whitespace-nowrap text-xs' : 'ml-auto whitespace-nowrap text-xs'}
          style={{
            color: over ? 'var(--danger-text)' : 'var(--text-light)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {max == null ? `${text.length} caracteres` : `${text.length} / ${max}`}
        </span>
      </div>
      <Textarea
        id={id}
        value={text}
        onChange={(e) => {
          if (!disabled) change(e.target.value);
        }}
        readOnly={disabled}
        placeholder={placeholder}
        className="min-h-[80px] resize-y read-only:cursor-default read-only:opacity-70"
        style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}
      />
      {hint && (
        <p className="text-xs" style={{ color: 'var(--text-light)' }}>
          {hint}
        </p>
      )}
    </div>
  );
});
