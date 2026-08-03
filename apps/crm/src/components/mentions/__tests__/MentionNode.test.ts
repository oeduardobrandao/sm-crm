import { describe, expect, it } from 'vitest';
import { getSchema, generateHTML, generateJSON, generateText } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import { MentionNode } from '../MentionNode';

// MentionNode alone isn't a full schema (no doc/paragraph/text nodes) -- pair it with
// StarterKit, exactly as PostEditor.tsx and ReadOnlyTipTap.tsx register it.
const extensions = [StarterKit, MentionNode];

describe('MentionNode', () => {
  it('is named "mention" and configured as an atomic inline node', () => {
    expect(MentionNode.name).toBe('mention');
    expect(MentionNode.config.inline).toBe(true);
    expect(MentionNode.config.group).toBe('inline');
    expect(MentionNode.config.atom).toBe(true);
    expect(MentionNode.config.selectable).toBe(true);
  });

  it('parses from span[data-mention]', () => {
    const parseRules = MentionNode.config.parseHTML!.call(MentionNode);
    expect(parseRules).toContainEqual({ tag: 'span[data-mention]' });
  });

  it('round-trips every attr (including a non-null parentId) through JSON persistence', () => {
    // This is the exact shape stored in `conteudo` -- ProseMirror JSON, not HTML.
    const attrs = { entityType: 'post', id: 2, label: 'Post de lançamento', parentId: 42 };
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'mention', attrs }] }],
    };

    const schema = getSchema(extensions);
    const parsed = PMNode.fromJSON(schema, doc);

    const found: unknown[] = [];
    parsed.descendants((node) => {
      if (node.type.name === 'mention') found.push(node.attrs);
    });

    expect(found).toEqual([attrs]);
  });

  it('round-trips a null parentId (membro/cliente/tarefa mentions have no parent)', () => {
    const attrs = { entityType: 'membro', id: 5, label: 'Ana', parentId: null };
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'mention', attrs }] }],
    };

    const schema = getSchema(extensions);
    const parsed = PMNode.fromJSON(schema, doc);

    const found: unknown[] = [];
    parsed.descendants((node) => {
      if (node.type.name === 'mention') found.push(node.attrs);
    });

    expect(found).toEqual([attrs]);
  });

  it('renders to HTML as a span with data-mention and the per-type chip class', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'mention',
              attrs: { entityType: 'tarefa', id: 4, label: 'Revisar copy', parentId: null },
            },
          ],
        },
      ],
    };

    const html = generateHTML(doc, extensions);

    expect(html).toContain('data-mention');
    expect(html).toContain('data-entity-type="tarefa"');
    expect(html).toContain('data-id="4"');
    expect(html).toContain('data-label="Revisar copy"');
    expect(html).not.toContain('data-parent-id');
    expect(html).toContain('mention-chip mention-chip--tarefa');
    expect(html).toContain('@Revisar copy');
  });

  it('renders a non-null parentId as data-parent-id and restores it as a number on reparse', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'mention',
              attrs: { entityType: 'post', id: 2, label: 'Post de lançamento', parentId: 42 },
            },
          ],
        },
      ],
    };

    const html = generateHTML(doc, extensions);
    expect(html).toContain('data-parent-id="42"');

    const reparsed = generateJSON(html, extensions);
    const mentionNode = reparsed.content[0].content[0];
    expect(mentionNode.attrs.id).toBe(2);
    expect(typeof mentionNode.attrs.id).toBe('number');
    expect(mentionNode.attrs.parentId).toBe(42);
    expect(typeof mentionNode.attrs.parentId).toBe('number');
  });

  it('renders text as "@Label" via renderText', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'mention', attrs: { entityType: 'cliente', id: 3, label: 'Clínica X' } },
          ],
        },
      ],
    };

    const text = generateText(doc, extensions);
    expect(text).toContain('@Clínica X');
  });
});
