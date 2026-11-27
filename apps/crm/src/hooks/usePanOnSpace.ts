import { useEffect, type RefObject } from 'react';

/**
 * Segurar Espaço e arrastar com o mouse rola o quadro na horizontal (como no Figma/Miro).
 *
 * - Só arma com o ponteiro sobre o container, sem foco em campo editável, fora de diálogo,
 *   sem modificadores e sem botão do mouse já pressionado (um arraste do dnd-kit em curso).
 * - Armado: `data-panning` no container (o CSS troca o cursor para "grab"), e o keydown/keyup
 *   do Espaço tem `preventDefault` (não rola a página nem clica no botão focado).
 * - O pointerdown armado é capturado antes do React: `stopPropagation` impede o PointerSensor
 *   do dnd-kit de começar um arraste de card, e o movimento vira `scrollLeft`.
 * - Solta no keyup, no blur da janela e quando o ponteiro sai do container (sem arraste).
 */
export function usePanOnSpace(
  ref: RefObject<HTMLElement | null>,
  { enabled = true }: { enabled?: boolean } = {},
): void {
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;

    let hovered = false;
    let spaceHeld = false;
    let pointerDown = false;
    let drag: { id: number; startX: number; startScroll: number } | null = null;

    const setAttr = () => {
      if (spaceHeld) el.setAttribute('data-panning', drag ? 'dragging' : 'ready');
      else el.removeAttribute('data-panning');
    };

    const endDrag = () => {
      if (!drag) return;
      try {
        if (el.hasPointerCapture?.(drag.id)) el.releasePointerCapture(drag.id);
      } catch {
        // Captura já liberada pelo navegador.
      }
      drag = null;
    };

    const release = () => {
      endDrag();
      spaceHeld = false;
      setAttr();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isSpace(e)) return;
      if (spaceHeld) {
        e.preventDefault();
        return;
      }
      if (e.repeat || !hovered || pointerDown) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return;
      if (isInsideDialog(document.activeElement)) return;
      e.preventDefault();
      spaceHeld = true;
      setAttr();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (!isSpace(e) || !spaceHeld) return;
      e.preventDefault();
      release();
    };

    const onWindowPointerDown = () => {
      pointerDown = true;
    };
    const onWindowPointerUp = () => {
      pointerDown = false;
    };

    const onPointerEnter = () => {
      hovered = true;
    };
    const onPointerLeave = () => {
      hovered = false;
      if (spaceHeld && !drag) release();
    };

    const onPointerDownCapture = (e: PointerEvent) => {
      if (!spaceHeld || e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      drag = { id: e.pointerId, startX: e.clientX, startScroll: el.scrollLeft };
      try {
        el.setPointerCapture?.(e.pointerId);
      } catch {
        // Sem captura o arraste ainda funciona enquanto o ponteiro estiver no container.
      }
      setAttr();
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      el.scrollLeft = drag.startScroll - (e.clientX - drag.startX);
    };

    const onPointerEnd = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      endDrag();
      setAttr();
    };

    // O clique no fim do arraste não pode abrir o card que estiver sob o cursor.
    const onClickCapture = (e: MouseEvent) => {
      if (!spaceHeld) return;
      e.stopPropagation();
      e.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', release);
    window.addEventListener('pointerdown', onWindowPointerDown);
    window.addEventListener('pointerup', onWindowPointerUp);
    window.addEventListener('pointercancel', onWindowPointerUp);
    el.addEventListener('pointerenter', onPointerEnter);
    el.addEventListener('pointerleave', onPointerLeave);
    el.addEventListener('pointerdown', onPointerDownCapture, true);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerEnd);
    el.addEventListener('pointercancel', onPointerEnd);
    el.addEventListener('click', onClickCapture, true);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', release);
      window.removeEventListener('pointerdown', onWindowPointerDown);
      window.removeEventListener('pointerup', onWindowPointerUp);
      window.removeEventListener('pointercancel', onWindowPointerUp);
      el.removeEventListener('pointerenter', onPointerEnter);
      el.removeEventListener('pointerleave', onPointerLeave);
      el.removeEventListener('pointerdown', onPointerDownCapture, true);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerEnd);
      el.removeEventListener('pointercancel', onPointerEnd);
      el.removeEventListener('click', onClickCapture, true);
      endDrag();
      el.removeAttribute('data-panning');
    };
  }, [ref, enabled]);
}

function isSpace(e: KeyboardEvent): boolean {
  return e.code === 'Space' || e.key === ' ';
}

const NON_TEXT_INPUTS = new Set([
  'button',
  'checkbox',
  'radio',
  'submit',
  'reset',
  'range',
  'color',
  'file',
]);

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !NON_TEXT_INPUTS.has((target as HTMLInputElement).type);
  return target.closest('[contenteditable="true"], [role="textbox"]') !== null;
}

function isInsideDialog(target: Element | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest('[role="dialog"], [role="alertdialog"]') !== null
  );
}
