import { act } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { textToMentionDoc } from '@/components/mentions/mentionDoc';

/** The TipTap editor behind a MentionEditor's contenteditable (TipTap sets `dom.editor`). */
export function editorOf(el: HTMLElement): Editor {
  const editor = (el as HTMLElement & { editor?: Editor }).editor;
  if (!editor) throw new Error('element is not a TipTap editor root');
  return editor;
}

/** jsdom can't type into a contenteditable; replace the content as a user edit would. */
export function setEditorText(el: HTMLElement, text: string) {
  act(() => {
    editorOf(el).commands.setContent(textToMentionDoc(text));
  });
}
