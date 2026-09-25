// Botões de desfazer/refazer do cabeçalho dos editores (relatório e modelo).
import { Redo2, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? '⌘' : 'Ctrl+';

export interface UndoRedoButtonsProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export function UndoRedoButtons({ canUndo, canRedo, onUndo, onRedo }: UndoRedoButtonsProps) {
  return (
    <div style={{ display: 'flex', gap: '0.25rem' }}>
      <Button
        variant="outline"
        size="sm"
        aria-label="Desfazer"
        title={`Desfazer (${MOD}Z)`}
        disabled={!canUndo}
        onClick={onUndo}
      >
        <Undo2 className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="outline"
        size="sm"
        aria-label="Refazer"
        title={`Refazer (${IS_MAC ? '⇧⌘Z' : 'Ctrl+Y'})`}
        disabled={!canRedo}
        onClick={onRedo}
      >
        <Redo2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
