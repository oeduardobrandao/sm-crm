// Bloco Imagem no canvas do editor (spec 2026-10-02): área de soltar, envio,
// seletor dos Arquivos, imagem assinada (blob via useFileUrl) e o popover de
// ajustes ancorado na célula. O layout só recebe file_id + dimensões; a URL
// fica no cache do useFileUrl e nunca vai para o config persistido (o src só
// entra numa cópia do bloco, na hora de renderizar).
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { ImagePlus, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { useFileUrl, seedImageUrl } from '@/hooks/useFileUrl';
import { FileApiError } from '@/services/fileApiError';
import { getClientFolderId, getClientReportsFolderId, uploadFile } from '@/services/fileService';
import { FilePickerModal } from '../arquivos/components/FilePickerModal';
import type { FileRecord } from '../arquivos/types';
import { ImageBlock } from '@mesaas/report-blocks/blocks/ImageBlock';
import { frameWidth, imageAspect, readImageConfig } from '@mesaas/report-blocks/image';
import type { BlockSize, ReportBlock, ReportDocSnapshot } from '@mesaas/report-blocks/types';
import { ImageSettingsPanel } from './ImageSettingsPanel';
import { REPORT_IMAGE_MIMES, prepareReportImage, validateReportImage } from './reportImageUpload';

export type ImageEditorContext = { mode: 'report'; clientId: number } | { mode: 'template' };

export interface ImageBlockEditorProps {
  block: ReportBlock;
  snapshot: ReportDocSnapshot;
  context: ImageEditorContext;
  onConfigChange: (id: string, patch: Record<string, unknown>) => void;
  onSizeChange: (size: BlockSize) => void;
  settingsOpen: boolean;
  onSettingsOpenChange: (open: boolean) => void;
}

/** Atributo do botão "Ajustes da imagem" na toolbar da célula (EditorCanvas):
 * o clique nele não conta como "fora" do popover, senão o Radix fecha no
 * pointerdown e o onClick do botão reabre na sequência. */
export const IMAGE_SETTINGS_TOGGLE_ATTR = 'data-img-settings-toggle';

const UPLOAD_FAILED = 'Não foi possível enviar a imagem.';

function uploadErrorMessage(err: unknown): string {
  if (err instanceof FileApiError && err.status === 413) {
    return 'Sem espaço de armazenamento no plano.';
  }
  return UPLOAD_FAILED;
}

function carriesFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files');
}

function loadDims(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('load'));
    img.src = url;
  });
}

export function ImageBlockEditor({
  block,
  snapshot,
  context,
  onConfigChange,
  onSizeChange,
  settingsOpen,
  onSettingsOpenChange,
}: ImageBlockEditorProps) {
  const cfg = readImageConfig(block.config);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<{ message: string; retry: boolean } | null>(null);
  const [uploading, setUploading] = useState<{ preview: string; pct: number } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerFolder, setPickerFolder] = useState<number | null>(null);
  const lastFile = useRef<File | null>(null);
  // Prévia local do envio em curso: liberada no fim do envio ou no unmount,
  // nunca a cada tique de progresso (a <img> ainda a está mostrando).
  const previewRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const isTemplate = context.mode === 'template';

  const url = useFileUrl(isTemplate ? null : cfg.fileId);

  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      previewRef.current = null;
    },
    [],
  );

  async function handleFile(file: File) {
    if (context.mode !== 'report' || busyRef.current) return;
    const invalid = validateReportImage(file);
    if (invalid) {
      setError({ message: invalid, retry: false });
      return;
    }
    setError(null);
    lastFile.current = file;
    busyRef.current = true;
    const preview = URL.createObjectURL(file);
    previewRef.current = preview;
    setUploading({ preview, pct: 0 });
    try {
      const prepared = await prepareReportImage(file);
      const folderId = await getClientReportsFolderId(context.clientId);
      const record = await uploadFile({
        file: prepared.file,
        folderId,
        onProgress: (p) => {
          if (p.total <= 0) return;
          const pct = Math.round((p.loaded / p.total) * 100);
          setUploading((u) => (u ? { ...u, pct } : u));
        },
      });
      if (record.url) seedImageUrl(record.id, record.url);
      onConfigChange(block.id, {
        file_id: record.id,
        width: prepared.width,
        height: prepared.height,
        ratio: 'original',
      });
    } catch (err) {
      const message = uploadErrorMessage(err);
      setError({ message, retry: message === UPLOAD_FAILED });
    } finally {
      busyRef.current = false;
      setUploading(null);
      if (previewRef.current === preview) previewRef.current = null;
      URL.revokeObjectURL(preview);
    }
  }

  function chooseFile() {
    inputRef.current?.click();
  }

  async function openPicker() {
    if (context.mode !== 'report') return;
    setPickerFolder(await getClientFolderId(context.clientId).catch(() => null));
    setPickerOpen(true);
  }

  async function handlePicked(files: FileRecord[]) {
    const f = files[0];
    if (!f) return;
    let width = f.width;
    let height = f.height;
    if ((!width || !height) && f.url) {
      try {
        ({ width, height } = await loadDims(f.url));
      } catch {
        width = null;
        height = null;
      }
    }
    if (!width || !height) {
      toast.error('Não foi possível abrir esta imagem.');
      return;
    }
    if (f.url) seedImageUrl(f.id, f.url);
    setError(null);
    onConfigChange(block.id, { file_id: f.id, width, height, ratio: 'original' });
  }

  // Anchor no canto superior direito do miolo: o popover abre ao lado da
  // célula, alinhado ao topo (mockup "Ajustes"); sem espaço à direita o Radix
  // vira para a esquerda.
  const settings = (
    <Popover open={settingsOpen} onOpenChange={onSettingsOpenChange}>
      <PopoverAnchor asChild>
        <span aria-hidden style={{ position: 'absolute', top: 0, right: 0, width: 0, height: 0 }} />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        side="right"
        sideOffset={12}
        className="w-auto"
        aria-label="Ajustes da imagem"
        onInteractOutside={(e) => {
          const target = e.target instanceof Element ? e.target : null;
          const toggle = target?.closest(`[${IMAGE_SETTINGS_TOGGLE_ATTR}]`);
          if (toggle?.getAttribute(IMAGE_SETTINGS_TOGGLE_ATTR) === block.id) e.preventDefault();
        }}
      >
        <ImageSettingsPanel
          block={block}
          mode={context.mode}
          onConfigChange={onConfigChange}
          onSizeChange={onSizeChange}
          onReplace={isTemplate ? undefined : chooseFile}
        />
      </PopoverContent>
    </Popover>
  );

  if (isTemplate) {
    const aspect = imageAspect(cfg);
    return (
      <div className="rb-img-wrap" style={{ position: 'relative' }}>
        {settings}
        <div
          className="rb-img-drop"
          style={{ aspectRatio: String(aspect), width: frameWidth(aspect), margin: '0 auto' }}
        >
          <ImagePlus className="h-5 w-5" aria-hidden />
          <p className="rb-img-drop-title">Espaço para imagem</p>
          <p className="rb-img-drop-hint">
            Cada relatório criado com este modelo começa com este espaço vazio, já no formato
            escolhido.
          </p>
        </div>
      </div>
    );
  }

  // Input, popover e seletor ficam montados em todos os estados (mesma
  // posição na árvore): "Escolher outra" e "Trocar imagem" clicam no input
  // de forma síncrona e o estado seguinte não pode desmontá-lo.
  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      hidden
      aria-label="Arquivo de imagem"
      accept={REPORT_IMAGE_MIMES.join(',')}
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (file) void handleFile(file);
      }}
    />
  );

  // Soltar arquivo: na área vazia/erro envia, no quadro preenchido ou
  // indisponível troca a imagem. Só arrasto com arquivo conta (texto do TipTap
  // passa direto); dragleave para um filho da área não apaga o destaque.
  const dropHandlers = {
    onDragOver: (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      setDragOver(true);
    },
    onDragLeave: (e: DragEvent) => {
      if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
      setDragOver(false);
    },
    onDrop: (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void handleFile(file);
    },
  };

  const pickerModal = (
    <FilePickerModal
      open={pickerOpen}
      onClose={() => setPickerOpen(false)}
      selectionMode="single"
      initialFolderId={pickerFolder}
      filterKind={['image']}
      allowedMimes={[...REPORT_IMAGE_MIMES]}
      onSelectRecords={(files) => void handlePicked(files)}
    />
  );

  let body;
  if (uploading) {
    body = (
      <div className="rb-img-progress">
        <img src={uploading.preview} alt="" style={{ width: '100%', borderRadius: 12 }} />
        <div className="rb-img-progress-bar" role="status">
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 600 }}>Enviando imagem</span>
            <span>{uploading.pct}%</span>
          </div>
          <div className="rb-img-progress-track">
            <div className="rb-img-progress-fill" style={{ width: `${uploading.pct}%` }} />
          </div>
        </div>
      </div>
    );
  } else if (cfg.fileId === null || error) {
    body = (
      <div
        className={`rb-img-drop${dragOver ? ' is-over' : ''}${error ? ' is-error' : ''}`}
        tabIndex={0}
        {...dropHandlers}
        onPaste={(e) => {
          const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith('image/'));
          if (file) {
            e.preventDefault();
            void handleFile(file);
          }
        }}
      >
        {error ? (
          <>
            <TriangleAlert className="h-5 w-5" aria-hidden />
            <p className="rb-img-drop-error" role="alert">
              {error.message}
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              {error.retry && lastFile.current && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (lastFile.current) void handleFile(lastFile.current);
                  }}
                >
                  Tentar novamente
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setError(null);
                  chooseFile();
                }}
              >
                Escolher outra
              </Button>
              {/* Troca que falhou: a imagem atual continua válida. */}
              {cfg.fileId !== null && (
                <Button size="sm" variant="ghost" onClick={() => setError(null)}>
                  Cancelar
                </Button>
              )}
            </div>
          </>
        ) : (
          <>
            <ImagePlus className="h-5 w-5" aria-hidden />
            <p className="rb-img-drop-title">Arraste uma imagem para cá</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button size="sm" variant="outline" onClick={chooseFile}>
                Enviar imagem
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void openPicker()}>
                Escolher dos arquivos
              </Button>
            </div>
            <p className="rb-img-drop-hint">
              JPG, PNG ou WebP até 10 MB. Também dá para colar uma imagem copiada. Imagens enviadas
              ficam nos Arquivos do cliente.
            </p>
          </>
        )}
      </div>
    );
  } else if (url.isError || url.data === null) {
    body = (
      <div className={`rb-img-drop is-error${dragOver ? ' is-over' : ''}`} {...dropHandlers}>
        <TriangleAlert className="h-5 w-5" aria-hidden />
        <p className="rb-img-drop-title">Imagem indisponível</p>
        <div style={{ display: 'flex', gap: 8 }}>
          {url.isError && (
            <Button size="sm" variant="outline" onClick={() => void url.refetch()}>
              Tentar novamente
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={chooseFile}>
            Trocar imagem
          </Button>
        </div>
      </div>
    );
  } else if (url.data) {
    // onDragStart: a <img> é arrastável e o arrasto dela leva "Files"; soltar
    // no próprio quadro reenviaria a mesma imagem. O dnd-kit usa ponteiro.
    body = (
      <div
        className={`rb-img-frame${dragOver ? ' is-over' : ''}`}
        data-testid="image-frame"
        onDragStart={(e) => e.preventDefault()}
        {...dropHandlers}
      >
        <ImageBlock
          block={{ ...block, config: { ...block.config, src: url.data } }}
          snapshot={snapshot}
        />
      </div>
    );
  } else {
    // Carregando a URL assinada: reserva o quadro no formato final.
    const aspect = imageAspect(cfg);
    body = (
      <div
        aria-busy="true"
        style={{
          aspectRatio: String(aspect),
          width: frameWidth(aspect),
          margin: '0 auto',
          borderRadius: 12,
          background: 'var(--surface-1)',
        }}
      />
    );
  }

  return (
    <div className="rb-img-wrap" style={{ position: 'relative' }}>
      {settings}
      {fileInput}
      {pickerModal}
      {body}
    </div>
  );
}
