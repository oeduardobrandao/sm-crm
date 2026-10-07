import { useEffect, useId, useState, type Ref } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapPin } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { buscarEnderecos, MIN_TEXTO_ENDERECO, type SugestaoEndereco } from './geoAutocomplete';

export interface LocalAutocompleteProps {
  value: string | null | undefined;
  onChange: (valor: string) => void;
  onBlur?: () => void;
  name?: string;
  ref?: Ref<HTMLInputElement>;
  id?: string;
  placeholder?: string;
  maxLength?: number;
  className?: string;
  disabled?: boolean;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  /** Typing pause before asking for suggestions. Tests pass 0. */
  debounceMs?: number;
}

/** Free-text "Local" input with address suggestions (Geoapify through the
 *  geo-autocomplete edge function). Anything typed is kept as is: "Sala 2" or
 *  "Google Meet" are valid. When the service is unavailable the field simply
 *  shows no suggestions. The list is rendered inline (not portaled) so it
 *  works inside the quick-create popover and the full-screen dialog. */
export function LocalAutocomplete({
  value,
  onChange,
  onBlur,
  name,
  ref,
  id,
  placeholder,
  maxLength = 300,
  className,
  disabled,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  debounceMs = 300,
}: LocalAutocompleteProps) {
  const texto = value ?? '';
  const listaId = useId();
  // Only what the user typed searches; a picked suggestion or a value that
  // came from the form (editing an event) does not.
  const [digitado, setDigitado] = useState(false);
  const [focado, setFocado] = useState(false);
  const [fechada, setFechada] = useState(false);
  const [ativo, setAtivo] = useState(-1);
  const [termo, setTermo] = useState('');

  useEffect(() => {
    if (!digitado) return;
    const t = setTimeout(() => setTermo(texto.trim()), debounceMs);
    return () => clearTimeout(t);
  }, [texto, digitado, debounceMs]);

  const { data: sugestoes = [] } = useQuery({
    queryKey: ['geo-autocomplete', termo],
    queryFn: ({ signal }) => buscarEnderecos(termo, signal),
    enabled: digitado && termo.length >= MIN_TEXTO_ENDERECO,
    staleTime: 10 * 60_000,
    retry: false,
  });

  const aberta = focado && digitado && !fechada && sugestoes.length > 0 && !disabled;

  // Escape closes the list, not the popover or dialog around it. Radix listens
  // for Escape on document in the capture phase, so stop it earlier, on window.
  useEffect(() => {
    if (!aberta) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setFechada(true);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [aberta]);

  const escolher = (s: SugestaoEndereco) => {
    onChange(s.rotulo.slice(0, maxLength));
    setDigitado(false);
    setAtivo(-1);
  };

  return (
    <div className="relative">
      <Input
        ref={ref}
        id={id}
        name={name}
        value={texto}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
        autoComplete="off"
        className={className}
        role="combobox"
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        aria-autocomplete="list"
        aria-expanded={aberta}
        aria-controls={aberta ? listaId : undefined}
        aria-activedescendant={aberta && ativo >= 0 ? `${listaId}-${ativo}` : undefined}
        onChange={(e) => {
          onChange(e.target.value);
          setDigitado(true);
          setFechada(false);
          setAtivo(-1);
        }}
        onFocus={() => setFocado(true)}
        onBlur={() => {
          setFocado(false);
          setAtivo(-1);
          onBlur?.();
        }}
        onKeyDown={(e) => {
          if (!aberta) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setAtivo((i) => (i + 1) % sugestoes.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setAtivo((i) => (i <= 0 ? sugestoes.length - 1 : i - 1));
          } else if (e.key === 'Enter' && ativo >= 0) {
            // Picks the highlighted address instead of submitting the form.
            e.preventDefault();
            escolher(sugestoes[ativo]);
          }
        }}
      />
      {aberta && (
        <div
          className="absolute left-0 right-0 top-full z-[60] mt-1 overflow-hidden rounded-lg border"
          style={{
            background: 'var(--card-bg)',
            borderColor: 'var(--border-color)',
            boxShadow: 'var(--shadow-popover, 0 12px 32px rgba(0, 0, 0, 0.16))',
          }}
        >
          <ul
            id={listaId}
            role="listbox"
            aria-label="Sugestões de endereço"
            className="m-0 list-none p-1"
          >
            {sugestoes.map((s, i) => (
              <li
                key={s.rotulo}
                id={`${listaId}-${i}`}
                role="option"
                aria-selected={i === ativo}
                className={cn(
                  'flex cursor-pointer items-start gap-2 rounded-md px-2.5 py-2 text-[13px]',
                  i === ativo && 'bg-[var(--surface-hover)]',
                )}
                // Keep focus in the input so blur doesn't close the list first.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setAtivo(i)}
                onClick={() => escolher(s)}
              >
                <MapPin
                  size={14}
                  className="mt-0.5 shrink-0"
                  style={{ color: 'var(--text-light)' }}
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span
                    className="block truncate font-medium"
                    style={{ color: 'var(--text-main)' }}
                  >
                    {s.linha1}
                  </span>
                  {s.linha2 && (
                    <span className="block truncate" style={{ color: 'var(--text-muted)' }}>
                      {s.linha2}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <div
            className="border-t px-3 py-1.5 text-right text-[11px]"
            style={{ borderColor: 'var(--border-color)', color: 'var(--text-light)' }}
          >
            <a
              href="https://www.geoapify.com/"
              target="_blank"
              rel="noopener noreferrer"
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              style={{ color: 'inherit' }}
            >
              Powered by Geoapify
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
