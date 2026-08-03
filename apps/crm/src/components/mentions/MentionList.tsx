import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { User, FileText, Building2, CheckSquare } from 'lucide-react';
import { avatarColorClass } from '@/lib/avatarColor';
import type { MentionSection, MentionSuggestionItem } from './useMentionSearch';

const MENTION_ICONS = {
  membro: User,
  post: FileText,
  cliente: Building2,
  tarefa: CheckSquare,
} as const;

const DROPDOWN_WIDTH = 280;
const DROPDOWN_MAX_HEIGHT = 320;
const VIEWPORT_MARGIN = 8;

/** A `getBoundingClientRect()`-shaped anchor. Callers (mentionSuggestion.ts for the
 * TipTap editor, MentionTextarea for plain-text fields -- Task 5) supply their own,
 * so this component never touches TipTap directly. */
export interface MentionListAnchorRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface MentionListProps {
  sections: MentionSection[];
  onSelect: (item: MentionSuggestionItem) => void;
  /** `null` hides the dropdown (no active match / not yet positioned). */
  referenceRect: MentionListAnchorRect | null;
}

export interface MentionListHandle {
  /** Returns true when the key was handled (caller should prevent default / stop
   * propagation into the host editor -- Enter must select, never insert a newline). */
  onKeyDown: (event: { key: string; preventDefault: () => void }) => boolean;
}

function MentionAvatar({ item }: { item: MentionSuggestionItem }) {
  if (item.entityType !== 'membro') {
    const Icon = MENTION_ICONS[item.entityType];
    return <Icon aria-hidden="true" className="mention-suggestion-item__icon" />;
  }
  const initials = item.label
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  if (item.avatarUrl) {
    return <img src={item.avatarUrl} alt="" className="comment-avatar mention-suggestion-avatar" />;
  }
  return (
    <span
      className={`comment-avatar comment-avatar--initials mention-suggestion-avatar ${avatarColorClass(item.id)}`}
    >
      {initials}
    </span>
  );
}

/**
 * Portal-rendered @-mention dropdown. Deliberately decoupled from TipTap -- it is
 * mounted by mentionSuggestion.ts for PostEditor, and reused as-is by MentionTextarea
 * (Task 5) for plain-text fields (comments, tarefa descriptions).
 */
export const MentionList = forwardRef<MentionListHandle, MentionListProps>(function MentionList(
  { sections, onSelect, referenceRect },
  ref,
) {
  const visibleSections = useMemo(() => sections.filter((s) => s.items.length > 0), [sections]);
  const flatItems = useMemo(() => visibleSections.flatMap((s) => s.items), [visibleSections]);
  const flatKey = flatItems.map((i) => `${i.entityType}:${i.id}`).join('|');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Keep the keyboard cursor in range whenever the result set changes shape (new
  // query resolved, section counts changed, etc.) instead of pointing at a stale row.
  useEffect(() => {
    setSelectedIndex(0);
  }, [flatKey]);

  useImperativeHandle(
    ref,
    () => ({
      onKeyDown(event) {
        if (flatItems.length === 0) return false;
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setSelectedIndex((i) => (i + 1) % flatItems.length);
          return true;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          setSelectedIndex((i) => (i - 1 + flatItems.length) % flatItems.length);
          return true;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault();
          const item = flatItems[selectedIndex];
          if (item) onSelect(item);
          return true;
        }
        return false;
      },
    }),
    [flatItems, selectedIndex, onSelect],
  );

  if (!referenceRect) return null;

  const left = Math.min(
    Math.max(VIEWPORT_MARGIN, referenceRect.left),
    window.innerWidth - DROPDOWN_WIDTH - VIEWPORT_MARGIN,
  );
  const spaceBelow = window.innerHeight - referenceRect.bottom;
  const openUpward =
    spaceBelow < DROPDOWN_MAX_HEIGHT + VIEWPORT_MARGIN &&
    referenceRect.top > DROPDOWN_MAX_HEIGHT + VIEWPORT_MARGIN;
  const top = openUpward
    ? Math.max(VIEWPORT_MARGIN, referenceRect.top - DROPDOWN_MAX_HEIGHT - 6)
    : referenceRect.bottom + 6;

  let runningIndex = -1;

  return createPortal(
    <div
      className="mention-suggestion-list"
      style={{
        position: 'fixed',
        top,
        left,
        width: DROPDOWN_WIDTH,
        maxHeight: DROPDOWN_MAX_HEIGHT,
        zIndex: 10050,
      }}
      // Selecting a row must not steal focus from the host editor/textarea before
      // onSelect runs (mousedown fires before click/blur).
      onMouseDown={(e) => e.preventDefault()}
    >
      {flatItems.length === 0 ? (
        <div className="mention-suggestion-empty">Nenhum resultado</div>
      ) : (
        visibleSections.map((section) => (
          <div key={section.key} className="mention-suggestion-section">
            <div className="mention-suggestion-section-title">{section.title}</div>
            {section.items.map((item) => {
              runningIndex += 1;
              const idx = runningIndex;
              const isActive = idx === selectedIndex;
              return (
                <button
                  key={`${item.entityType}:${item.id}`}
                  type="button"
                  className={`mention-suggestion-item${isActive ? ' mention-suggestion-item--active' : ''}`}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => onSelect(item)}
                >
                  <MentionAvatar item={item} />
                  <span className="mention-suggestion-item__label">{item.label}</span>
                </button>
              );
            })}
          </div>
        ))
      )}
    </div>,
    document.body,
  );
});
