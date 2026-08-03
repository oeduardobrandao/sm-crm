import { Extension } from '@tiptap/core';
import Suggestion, { type SuggestionOptions, type SuggestionProps } from '@tiptap/suggestion';
import { ReactRenderer } from '@tiptap/react';
import { MentionList } from './MentionList';
import type { MentionListHandle, MentionListProps } from './MentionList';
import type { MentionSection, MentionSuggestionItem } from './useMentionSearch';

export interface MentionSuggestionOptions {
  /** Imperative fetcher backing the dropdown -- see useMentionSearch.ts. Injected from
   * PostEditor so this extension stays free of React Query / store imports. */
  search: (query: string) => Promise<MentionSection[]>;
}

/**
 * `@`-mention suggestion dropdown. A separate Extension from `MentionNode` (which stays
 * a pure, presentation-only node shared with the hub's read-only mirror) so the plugin
 * can be attached ONLY to the editable CRM editor (PostEditor). ReadOnlyTipTap and the
 * hub's MentionReadonly node must never register this extension.
 */
export const MentionSuggestion = Extension.create<MentionSuggestionOptions>({
  name: 'mentionSuggestion',

  addOptions() {
    return {
      search: async () => [],
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;

    const suggestion: Omit<SuggestionOptions<MentionSection, MentionSuggestionItem>, 'editor'> = {
      char: '@',
      allowSpaces: false,

      items: ({ query }) => options.search(query),

      command: ({ editor, range, props }) => {
        const attrs = {
          entityType: props.entityType,
          id: props.id,
          label: props.label,
          parentId: props.entityType === 'post' ? (props.parentId ?? null) : null,
        };
        editor
          .chain()
          .focus()
          .insertContentAt(range, [
            { type: 'mention', attrs },
            { type: 'text', text: ' ' },
          ])
          .run();
      },

      render: () => {
        let component: ReactRenderer<MentionListHandle, MentionListProps> | null = null;

        // The plugin's view.update is async (it awaits items()), so overlapping calls
        // from consecutive keystrokes can resolve out of order -- an older, slower
        // call can land AFTER a newer one and overwrite the dropdown with stale
        // results. onBeforeStart/onBeforeUpdate fire synchronously before the await,
        // so tagging each call there and comparing on the other side of the await
        // (onStart/onUpdate) lets a genuinely-stale resolution be dropped.
        let renderSeq = 0;
        let latestAppliedSeq = 0;
        const seqByProps = new WeakMap<object, number>();

        const tag = (props: object) => {
          renderSeq += 1;
          seqByProps.set(props, renderSeq);
        };

        const buildListProps = (
          props: SuggestionProps<MentionSection, MentionSuggestionItem>,
        ): MentionListProps => ({
          sections: props.items,
          onSelect: (item) => props.command(item),
          referenceRect: props.clientRect?.() ?? null,
        });

        return {
          onBeforeStart: tag,
          onBeforeUpdate: tag,

          onStart: (props) => {
            latestAppliedSeq = seqByProps.get(props) ?? renderSeq;
            component = new ReactRenderer(MentionList, {
              editor: props.editor,
              props: buildListProps(props),
            });
          },

          onUpdate: (props) => {
            const seq = seqByProps.get(props) ?? 0;
            if (seq < latestAppliedSeq) return; // superseded by a newer, already-applied call
            latestAppliedSeq = seq;
            component?.updateProps(buildListProps(props));
          },

          onKeyDown: (props) => component?.ref?.onKeyDown(props.event) ?? false,

          onExit: () => {
            component?.destroy();
            component = null;
          },
        };
      },
    };

    return [Suggestion({ editor: this.editor, ...suggestion })];
  },
});
