import { describe, expect, it } from 'vitest';
import {
  isTarefaDescriptionEmpty,
  plainTextToTarefaDescriptionDoc,
  sanitizeTarefaDescriptionDoc,
} from '../tarefaDescription';

describe('tarefa rich descriptions', () => {
  it('treats an image-only document as meaningful content', () => {
    expect(
      isTarefaDescriptionEmpty({
        type: 'doc',
        content: [
          {
            type: 'inlineImage',
            attrs: { r2Key: 'contas/1/files/reference.png', width: 800, height: 600 },
          },
        ],
      }),
    ).toBe(false);
  });

  it('treats whitespace-only text as an empty description', () => {
    expect(
      isTarefaDescriptionEmpty({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: '   ' }] },
          { type: 'paragraph' },
        ],
      }),
    ).toBe(true);
  });

  it('removes transient signed image data while preserving stable image metadata', () => {
    expect(
      sanitizeTarefaDescriptionDoc({
        type: 'doc',
        content: [
          {
            type: 'inlineImage',
            attrs: {
              r2Key: 'contas/1/files/reference.png',
              src: 'https://signed.example/reference.png?expires=1',
              blurSrc: 'data:image/png;base64,abc',
              loading: false,
              width: 800,
              height: 600,
              displayWidth: 400,
              alt: 'Referência',
            },
          },
        ],
      }),
    ).toEqual({
      type: 'doc',
      content: [
        {
          type: 'inlineImage',
          attrs: {
            r2Key: 'contas/1/files/reference.png',
            width: 800,
            height: 600,
            displayWidth: 400,
            alt: 'Referência',
          },
        },
      ],
    });
  });

  it('removes unfinished image uploads from the document', () => {
    const sanitized = sanitizeTarefaDescriptionDoc({
      type: 'doc',
      content: [
        {
          type: 'inlineImage',
          attrs: { loading: true, blurSrc: 'data:image/png;base64,abc' },
        },
      ],
    });

    expect(sanitized).toEqual({ type: 'doc', content: [] });
    expect(isTarefaDescriptionEmpty(sanitized)).toBe(true);
  });

  it('converts legacy mention tokens into TipTap mention nodes', () => {
    expect(plainTextToTarefaDescriptionDoc('Oi @[Ana](membro:5)')).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Oi ' },
            {
              type: 'mention',
              attrs: { entityType: 'membro', id: 5, label: 'Ana', parentId: null },
            },
          ],
        },
      ],
    });
  });
});
