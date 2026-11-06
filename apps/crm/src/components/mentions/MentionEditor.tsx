import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { SuggestionPluginKey } from '@tiptap/suggestion';
import { MentionNode } from './MentionNode';
import { MentionSuggestion } from './mentionSuggestion';
import { useMentionSearch } from './useMentionSearch';
import { mentionDocToText, textToMentionDoc } from './mentionDoc';

export interface MentionEditorHandle {
  /** Focuses the editor with the caret at the end. */
  focus(): void;
}

export interface MentionEditorProps {
  /** Plain text with `@[Label](tipo:id)` tokens (mentionTokens.ts). */
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  /** Lands on the contenteditable itself, so `.comment-*-input` rules style it directly. */
  className?: string;
  /** Class for the wrapper div (layout inside the host, e.g. flex: 1 beside a button). */
  rootClassName?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Runs while no @-suggestion is open; call preventDefault() to consume the key. */
  onKeyDown?: (event: KeyboardEvent) => void;
}

/**
 * Comment input where a picked @-mention shows as the same chip the post editor
 * renders (MentionNode), instead of the raw `@[Label](tipo:id)` token a textarea
 * would show. Value in/out stays the plain token string (mentionDoc.ts), so callers
 * and the stored comment format are unchanged. Enter adds a line unless onKeyDown
 * consumes it; Shift+Enter always adds a line.
 */
export const MentionEditor = forwardRef<MentionEditorHandle, MentionEditorProps>(
  function MentionEditor(
    {
      value,
      onValueChange,
      placeholder,
      className,
      rootClassName,
      disabled = false,
      autoFocus,
      onKeyDown,
    },
    ref,
  ) {
    // Extensions and handlers are frozen at creation (useEditor has no deps), so
    // everything that changes between renders is read through a ref.
    const { search } = useMentionSearch();
    const searchRef = useRef(search);
    const onValueChangeRef = useRef(onValueChange);
    const onKeyDownRef = useRef(onKeyDown);
    useEffect(() => {
      searchRef.current = search;
      onValueChangeRef.current = onValueChange;
      onKeyDownRef.current = onKeyDown;
    });
    const searchFn = useRef((query: string) => searchRef.current(query)).current;
    // Last text this editor emitted or was synced to; a `value` equal to it is an echo.
    const lastTextRef = useRef(value);

    const editor = useEditor({
      extensions: [
        StarterKit.configure({
          blockquote: false,
          bold: false,
          bulletList: false,
          code: false,
          codeBlock: false,
          dropcursor: false,
          gapcursor: false,
          heading: false,
          horizontalRule: false,
          italic: false,
          link: false,
          listItem: false,
          listKeymap: false,
          orderedList: false,
          strike: false,
          trailingNode: false,
          underline: false,
        }),
        Placeholder.configure({ placeholder: placeholder ?? '' }),
        MentionNode,
        MentionSuggestion.configure({ search: searchFn }),
      ],
      content: textToMentionDoc(value),
      editable: !disabled,
      autofocus: autoFocus ? 'end' : false,
      editorProps: {
        attributes: {
          class: className ? `mention-editor ${className}` : 'mention-editor',
          role: 'textbox',
          'aria-multiline': 'true',
          ...(placeholder ? { 'aria-label': placeholder, 'aria-placeholder': placeholder } : {}),
        },
        handleKeyDown: (view, event) => {
          if (event.isComposing) return false;
          if (SuggestionPluginKey.getState(view.state)?.active) {
            // The suggestion plugin closes the dropdown on Escape; keep that key from
            // also reaching a document-level "Escape closes the popover" listener.
            if (event.key === 'Escape') event.stopPropagation();
            return false;
          }
          onKeyDownRef.current?.(event);
          return event.defaultPrevented;
        },
      },
      onUpdate: ({ editor: e }) => {
        const text = mentionDocToText(e.getJSON());
        lastTextRef.current = text;
        onValueChangeRef.current(text);
      },
    });

    useEffect(() => {
      if (!editor || editor.isDestroyed || value === lastTextRef.current) return;
      lastTextRef.current = value;
      editor.commands.setContent(textToMentionDoc(value), { emitUpdate: false });
    }, [editor, value]);

    useEffect(() => {
      if (!editor || editor.isDestroyed) return;
      editor.setEditable(!disabled, false);
    }, [editor, disabled]);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          if (editor && !editor.isDestroyed) editor.commands.focus('end');
        },
      }),
      [editor],
    );

    return <EditorContent editor={editor} className={rootClassName} />;
  },
);
