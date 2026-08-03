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

        // NOTE: `@tiptap/suggestion`'s plugin `view.update` is async (it awaits
        // items()), but it reuses a SINGLE closure-level `props` object across
        // updates and re-reads it after the await resolves -- it does not hand each
        // call its own snapshot. That means a per-call ordering guard here (tagging
        // `props` and comparing identities) is structurally unable to detect a stale
        // resolution: by the time onUpdate fires, `props` already IS whatever the
        // latest call left behind. The out-of-order-results guard instead lives in
        // useMentionSearch.ts's `search()`, where "which call is newest" is
        // unambiguous -- a superseded call there returns the last-applied result
        // rather than its own (possibly stale) one, so `items` below never resolves
        // with out-of-order data in the first place.
        const buildListProps = (
          props: SuggestionProps<MentionSection, MentionSuggestionItem>,
        ): MentionListProps => ({
          sections: props.items,
          onSelect: (item) => props.command(item),
          referenceRect: props.clientRect?.() ?? null,
        });

        return {
          onStart: (props) => {
            component = new ReactRenderer(MentionList, {
              editor: props.editor,
              props: buildListProps(props),
            });
          },

          onUpdate: (props) => {
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
