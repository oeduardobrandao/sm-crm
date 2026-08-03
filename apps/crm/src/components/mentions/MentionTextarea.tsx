import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import type {
  ChangeEvent,
  FocusEvent,
  FocusEventHandler,
  KeyboardEvent,
  KeyboardEventHandler,
  MouseEvent,
  MouseEventHandler,
  TextareaHTMLAttributes,
} from 'react';
import { MentionList } from './MentionList';
import type { MentionListAnchorRect, MentionListHandle } from './MentionList';
import { useMentionSearch } from './useMentionSearch';
import type { MentionSection, MentionSuggestionItem } from './useMentionSearch';
import { formatMentionToken } from './mentionTokens';

export interface MentionTextareaProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'value' | 'onChange'
> {
  value: string;
  onValueChange: (value: string) => void;
}

interface ActiveTrigger {
  /** Index of the triggering `@` in `value`. */
  start: number;
  query: string;
}

/**
 * An `@query` is active immediately before `caret` when: the text between the LAST
 * `@` at or before the caret and the caret itself is whitespace-free (`[^\s@]*`),
 * and that `@` sits at the start of the text or right after whitespace.
 */
function findActiveTrigger(text: string, caret: number): ActiveTrigger | null {
  const upToCaret = text.slice(0, caret);
  const at = upToCaret.lastIndexOf('@');
  if (at === -1) return null;
  const before = at === 0 ? '' : upToCaret[at - 1];
  if (before !== '' && !/\s/.test(before)) return null;
  const query = upToCaret.slice(at + 1);
  if (/\s/.test(query)) return null;
  return { start: at, query };
}

/**
 * Controlled `<textarea>` drop-in with @-mention autocomplete for plain-text fields
 * (post comments, tarefa descricoes -- see mentionTokens.ts for the token syntax
 * those fields store). Reuses MentionList/useMentionSearch, the same building blocks
 * behind the TipTap suggestion dropdown (mentionSuggestion.ts), so results and
 * keyboard behavior match everywhere @-mentions appear.
 *
 * Controlled via `value`/`onValueChange` rather than the native `value`/`onChange`
 * pair: selecting a suggestion mutates `value` programmatically (there is no native
 * change event for that edit), so callers need a single "value changed, for any
 * reason" callback instead of wiring two.
 */
export const MentionTextarea = forwardRef<HTMLTextAreaElement, MentionTextareaProps>(
  function MentionTextarea(
    { value, onValueChange, onKeyDown, onKeyUp, onBlur, onClick, ...rest },
    forwardedRef,
  ) {
    const innerRef = useRef<HTMLTextAreaElement | null>(null);
    useImperativeHandle(forwardedRef, () => innerRef.current as HTMLTextAreaElement);

    const [trigger, setTrigger] = useState<ActiveTrigger | null>(null);
    const [sections, setSections] = useState<MentionSection[]>([]);
    const [anchorRect, setAnchorRect] = useState<MentionListAnchorRect | null>(null);
    const listRef = useRef<MentionListHandle>(null);
    const { search } = useMentionSearch();
    // Set right before a keydown WE consume (dropdown nav/select, Escape) so the
    // keyup that follows it doesn't immediately re-derive a trigger off of that same
    // keystroke -- Enter-to-select and Escape-to-close both already resolve trigger
    // state themselves; re-deriving on keyup would fight them.
    const skipNextKeyUpRef = useRef(false);

    const closeTrigger = useCallback(() => {
      setTrigger(null);
      setAnchorRect(null);
    }, []);

    const syncTrigger = useCallback(
      (text: string, caret: number, el: HTMLTextAreaElement) => {
        const next = findActiveTrigger(text, caret);
        setTrigger(next);
        if (!next) {
          setAnchorRect(null);
          return;
        }
        const rect = el.getBoundingClientRect();
        setAnchorRect({ top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right });
        // useMentionSearch's search() guarantees a superseded call resolves to the
        // last-applied (i.e. still-correct) result rather than its own stale one, so
        // no extra ordering guard is needed on this side -- see its doc comment.
        search(next.query).then(setSections);
      },
      [search],
    );

    const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
      onValueChange(e.target.value);
      syncTrigger(e.target.value, e.target.selectionStart ?? e.target.value.length, e.target);
    };

    const handleClick: MouseEventHandler<HTMLTextAreaElement> = (
      e: MouseEvent<HTMLTextAreaElement>,
    ) => {
      onClick?.(e);
      const el = e.currentTarget;
      syncTrigger(el.value, el.selectionStart ?? el.value.length, el);
    };

    const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (
      e: KeyboardEvent<HTMLTextAreaElement>,
    ) => {
      if (trigger && !e.nativeEvent.isComposing) {
        if (listRef.current?.onKeyDown(e)) {
          skipNextKeyUpRef.current = true;
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          // Stops the event before it reaches any ancestor "Escape closes me" handler
          // (e.g. PostCommentPopover's document-level listener) -- the first Escape
          // should only close the dropdown, not the whole host surface too.
          e.stopPropagation();
          skipNextKeyUpRef.current = true;
          closeTrigger();
          return;
        }
      }
      onKeyDown?.(e);
    };

    const handleKeyUp: KeyboardEventHandler<HTMLTextAreaElement> = (
      e: KeyboardEvent<HTMLTextAreaElement>,
    ) => {
      onKeyUp?.(e);
      if (skipNextKeyUpRef.current) {
        skipNextKeyUpRef.current = false;
        return;
      }
      const el = e.currentTarget;
      syncTrigger(el.value, el.selectionStart ?? el.value.length, el);
    };

    const handleBlur: FocusEventHandler<HTMLTextAreaElement> = (
      e: FocusEvent<HTMLTextAreaElement>,
    ) => {
      // MentionList's row wrapper preventDefaults its mousedown specifically so a row
      // click never moves focus off this textarea -- so a real blur here always means
      // focus genuinely left (click elsewhere, Tab away), safe to close unconditionally.
      closeTrigger();
      onBlur?.(e);
    };

    const handleSelectMention = useCallback(
      (item: MentionSuggestionItem) => {
        if (!trigger) return;
        const replaceEnd = trigger.start + 1 + trigger.query.length;
        const token = formatMentionToken(item);
        const nextValue = `${value.slice(0, trigger.start)}${token} ${value.slice(replaceEnd)}`;
        const nextCaret = trigger.start + token.length + 1;
        closeTrigger();
        onValueChange(nextValue);
        // The new caret position only makes sense once `value` (a controlled prop)
        // has round-tripped back down through the parent's re-render -- rAF runs
        // after that commit, so setSelectionRange lands on the updated DOM value.
        requestAnimationFrame(() => {
          const el = innerRef.current;
          if (!el) return;
          el.focus();
          el.setSelectionRange(nextCaret, nextCaret);
        });
      },
      [trigger, value, onValueChange, closeTrigger],
    );

    return (
      <>
        <textarea
          {...rest}
          ref={innerRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          onClick={handleClick}
          onBlur={handleBlur}
        />
        {trigger && (
          <MentionList
            ref={listRef}
            sections={sections}
            onSelect={handleSelectMention}
            referenceRect={anchorRect}
          />
        )}
      </>
    );
  },
);
