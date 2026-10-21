// Arquivo solto fora de uma área de soltar faria o navegador abrir o arquivo
// e descarregar o editor. Os listeners ficam no document, em bubble: as áreas
// do bloco Imagem (React, no #root) e o ProseMirror (no elemento do editor)
// tratam o evento antes; aqui só cancelamos o que sobrou. Arrastos sem
// arquivo (texto/HTML do TipTap) passam intactos, e o dnd-kit usa ponteiro,
// não drag and drop nativo.
import { useEffect } from 'react';

function carriesFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files');
}

export function usePreventStrayFileDrop(): void {
  useEffect(() => {
    function onDragOver(e: DragEvent) {
      // Já aceito por uma área de soltar (ou pelo ProseMirror): não mexe no
      // dropEffect dela.
      if (!carriesFiles(e) || e.defaultPrevented) return;
      e.preventDefault();
      // Cursor de "não permitido" fora das áreas de soltar.
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
    }
    function onDrop(e: DragEvent) {
      if (carriesFiles(e)) e.preventDefault();
    }
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('drop', onDrop);
    };
  }, []);
}
