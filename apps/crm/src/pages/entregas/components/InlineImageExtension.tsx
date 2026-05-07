import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Loader2, ImageIcon } from 'lucide-react';

const INLINE_IMAGE_MAX_SIZE = 10 * 1024 * 1024;
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export type InlineImageUploadFn = (file: File) => Promise<{
  r2Key: string;
  src: string;
  width: number;
  height: number;
}>;

function InlineImageNodeView({ node }: NodeViewProps) {
  const { src, blurSrc, loading, width, height } = node.attrs;

  if (loading) {
    return (
      <NodeViewWrapper as="figure" className="inline-image-wrapper" data-loading="true">
        <div
          style={{
            position: 'relative',
            maxWidth: '100%',
            aspectRatio: width && height ? `${width}/${height}` : undefined,
            borderRadius: '8px',
            overflow: 'hidden',
            background: 'var(--surface-darker)',
          }}
        >
          {blurSrc ? (
            <img
              src={blurSrc}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(8px)', transform: 'scale(1.1)' }}
            />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '120px' }}>
              <ImageIcon size={32} style={{ opacity: 0.3 }} />
            </div>
          )}
          <div
            style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(0,0,0,0.25)',
            }}
          >
            <Loader2 size={28} className="animate-spin" style={{ color: '#fff' }} />
          </div>
        </div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper as="figure" className="inline-image-wrapper">
      <img
        src={src}
        alt={node.attrs.alt ?? ''}
        style={{
          maxWidth: '100%',
          borderRadius: '8px',
          display: 'block',
          margin: '0.5rem 0',
        }}
      />
    </NodeViewWrapper>
  );
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    inlineImage: {
      insertInlineImage: (attrs: {
        r2Key: string;
        src: string;
        width?: number;
        height?: number;
        alt?: string;
      }) => ReturnType;
    };
  }
}

function isValidImageFile(file: File): boolean {
  return ALLOWED_MIME.includes(file.type) && file.size <= INLINE_IMAGE_MAX_SIZE;
}

function getImageFiles(dataTransfer: DataTransfer): File[] {
  const files: File[] = [];
  for (let i = 0; i < dataTransfer.files.length; i++) {
    const file = dataTransfer.files[i];
    if (isValidImageFile(file)) files.push(file);
  }
  return files;
}

const inlineImagePluginKey = new PluginKey('inlineImageUpload');

export function createInlineImageExtension(uploadFn: InlineImageUploadFn) {
  return Node.create({
    name: 'inlineImage',
    group: 'block',
    atom: true,
    draggable: true,

    addAttributes() {
      return {
        r2Key: { default: null },
        src: { default: null },
        blurSrc: { default: null },
        alt: { default: '' },
        width: { default: null },
        height: { default: null },
        loading: { default: false },
      };
    },

    parseHTML() {
      return [{ tag: 'figure[data-inline-image]' }];
    },

    renderHTML({ HTMLAttributes }) {
      return ['figure', mergeAttributes(HTMLAttributes, { 'data-inline-image': '' }), ['img', { src: HTMLAttributes.src }]];
    },

    addNodeView() {
      return ReactNodeViewRenderer(InlineImageNodeView);
    },

    addCommands() {
      return {
        insertInlineImage: (attrs) => ({ commands }) => {
          return commands.insertContent({ type: this.name, attrs });
        },
      };
    },

    addProseMirrorPlugins() {
      const extension = this;

      return [
        new Plugin({
          key: inlineImagePluginKey,

          props: {
            handlePaste(view, event) {
              const clipboardData = event.clipboardData;
              if (!clipboardData) return false;

              const files = getImageFiles(clipboardData);
              if (files.length === 0) return false;

              event.preventDefault();
              for (const file of files) {
                handleImageUpload(view, file, extension.name, uploadFn);
              }
              return true;
            },

            handleDrop(view, event) {
              const dataTransfer = event.dataTransfer;
              if (!dataTransfer) return false;

              const files = getImageFiles(dataTransfer);
              if (files.length === 0) return false;

              event.preventDefault();
              for (const file of files) {
                handleImageUpload(view, file, extension.name, uploadFn);
              }
              return true;
            },
          },
        }),
      ];
    },
  });
}

async function handleImageUpload(
  view: any,
  file: File,
  nodeType: string,
  uploadFn: InlineImageUploadFn,
) {
  const { state, dispatch } = view;
  const { tr, schema } = state;

  const blurSrc = await createBlurPreview(file).catch(() => null);
  const type = schema.nodes[nodeType];
  const placeholderNode = type.create({ loading: true, blurSrc });
  dispatch(tr.replaceSelectionWith(placeholderNode));

  try {
    const result = await uploadFn(file);

    const { state: newState } = view;
    const newTr = newState.tr;
    let replaced = false;

    newState.doc.descendants((node: any, pos: number) => {
      if (replaced) return false;
      if (node.type.name === nodeType && node.attrs.loading === true && node.attrs.blurSrc === blurSrc) {
        newTr.setNodeMarkup(pos, undefined, {
          r2Key: result.r2Key,
          src: result.src,
          alt: '',
          width: result.width,
          height: result.height,
          loading: false,
          blurSrc: null,
        });
        replaced = true;
        return false;
      }
    });

    if (replaced) view.dispatch(newTr);
  } catch (err) {
    const { state: newState } = view;
    const newTr = newState.tr;
    let removed = false;

    newState.doc.descendants((node: any, pos: number) => {
      if (removed) return false;
      if (node.type.name === nodeType && node.attrs.loading === true && node.attrs.blurSrc === blurSrc) {
        newTr.delete(pos, pos + node.nodeSize);
        removed = true;
        return false;
      }
    });

    if (removed) view.dispatch(newTr);
    throw err;
  }
}

function createBlurPreview(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const ratio = img.naturalWidth / img.naturalHeight;
        const size = 16;
        const w = ratio >= 1 ? size : Math.round(size * ratio);
        const h = ratio >= 1 ? Math.round(size / ratio) : size;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/webp', 0.2));
      } catch (e) { reject(e); }
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}
