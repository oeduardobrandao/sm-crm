import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import UnderlineExt from '@tiptap/extension-underline';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import { CalloutExtension } from './CalloutExtension';
import { MentionNode } from '@/components/mentions/MentionNode';

interface ReadOnlyTipTapProps {
  content: Record<string, unknown>;
  className?: string;
}

export const readOnlyTipTapExtensions = [
  StarterKit,
  UnderlineExt,
  TextStyle,
  Color,
  Highlight.configure({ multicolor: true }),
  Link.configure({ openOnClick: true, autolink: false }),
  CalloutExtension,
  MentionNode,
];

export function ReadOnlyTipTap({ content, className }: ReadOnlyTipTapProps) {
  const editor = useEditor({
    extensions: readOnlyTipTapExtensions,
    content,
    editable: false,
  });

  return (
    <div className={className}>
      <EditorContent editor={editor} className="post-editor-content" />
    </div>
  );
}
