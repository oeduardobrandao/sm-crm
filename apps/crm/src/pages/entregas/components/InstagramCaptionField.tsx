import { useState, useRef, useEffect } from 'react';
import { Instagram, Lock } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface InstagramCaptionFieldProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  lockedMessage?: string;
}

const MAX_CHARS = 2200;

export function InstagramCaptionField({ value, onChange, disabled, lockedMessage }: InstagramCaptionFieldProps) {
  const [local, setLocal] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => { setLocal(value); }, [value]);

  const handleChange = (newVal: string) => {
    if (newVal.length > MAX_CHARS) return;
    setLocal(newVal);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onChange(newVal), 1500);
  };

  return (
    <div className="mt-3 rounded-lg border-2 p-3" style={{ borderColor: 'var(--border-color)', background: 'var(--surface-hover)' }}>
      <div className="flex items-center gap-2 mb-2">
        <Instagram className="h-4 w-4" style={{ color: '#E1306C' }} />
        <span className="text-sm font-semibold" style={{ color: 'var(--text-main)' }}>
          Legenda do Instagram
        </span>
        {disabled && lockedMessage && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Lock className="h-3.5 w-3.5 ml-auto" style={{ color: 'var(--text-light)' }} />
            </TooltipTrigger>
            <TooltipContent>{lockedMessage}</TooltipContent>
          </Tooltip>
        )}
        <span className="ml-auto text-xs" style={{ color: 'var(--text-light)', fontFamily: 'var(--font-mono)' }}>
          {local.length} / {MAX_CHARS}
        </span>
      </div>
      <Textarea
        value={local}
        onChange={(e) => handleChange(e.target.value)}
        disabled={disabled}
        placeholder="Texto exato que será publicado no Instagram. Suporta emojis e hashtags."
        className="min-h-[80px] resize-y"
        style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}
      />
      <p className="text-xs mt-1" style={{ color: 'var(--text-light)' }}>
        Texto exato que será publicado no Instagram. Suporta emojis e hashtags.
      </p>
    </div>
  );
}
