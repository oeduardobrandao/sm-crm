import { useState, useRef, useEffect, useCallback } from 'react';

interface InlineRenameInputProps {
  currentName: string;
  onCommit: (newName: string) => void;
  onCancel: () => void;
}

export function InlineRenameInput({ currentName, onCommit, onCancel }: InlineRenameInputProps) {
  const [value, setValue] = useState(currentName);
  const inputRef = useRef<HTMLInputElement>(null);
  const committed = useRef(false);

  useEffect(() => {
    const input = inputRef.current;
    if (input) {
      input.focus();
      const dotIndex = currentName.lastIndexOf('.');
      if (dotIndex > 0) {
        input.setSelectionRange(0, dotIndex);
      } else {
        input.select();
      }
    }
  }, [currentName]);

  const commit = useCallback(() => {
    if (committed.current) return;
    committed.current = true;
    const trimmed = value.trim();
    if (!trimmed || trimmed === currentName) {
      onCancel();
    } else {
      onCommit(trimmed);
    }
  }, [value, currentName, onCommit, onCancel]);

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          committed.current = true;
          onCancel();
        }
        e.stopPropagation();
      }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className="w-full bg-[var(--surface-main)] text-[var(--text-main)] text-xs font-medium border border-[var(--primary-color)] rounded px-1.5 py-0.5 outline-none font-[var(--font-mono)]"
      spellCheck={false}
    />
  );
}
