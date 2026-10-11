import { useState } from 'react';
import { List } from 'lucide-react';
import { PhoneIconButton } from '@/components/mobile/LargeTitleHeader';
import { BottomSheet } from '@/components/mobile/BottomSheet';
import { GroupedList, Cell } from '@/components/mobile/GroupedList';
import { useSheetActions } from '@/components/mobile/sheetActions';
import type { TocItem } from '../components/TableOfContents';

function TocList({ items }: { items: TocItem[] }) {
  const { closeThen } = useSheetActions();
  return (
    <GroupedList aria-label="Neste artigo">
      {items.map((item) => (
        <Cell
          key={item.id}
          label={item.text}
          className={item.level === 3 ? 'phone-ajuda-toc-sub' : undefined}
          onClick={() =>
            closeThen(() =>
              document.getElementById(item.id)?.scrollIntoView({ behavior: 'smooth' }),
            )
          }
        />
      ))}
    </GroupedList>
  );
}

/**
 * The article's table of contents on phones (the desktop rail only shows from 1280px):
 * an "Índice" button in the nav bar opening a sheet with the headings. Hidden for
 * articles with fewer than two headings, like the rail.
 */
export function ArticleTocButton({ items }: { items: TocItem[] }) {
  const [open, setOpen] = useState(false);
  if (items.length < 2) return null;
  return (
    <>
      <PhoneIconButton
        label="Índice"
        aria-haspopup="dialog"
        className="phone-ajuda-toc-button"
        onClick={() => setOpen(true)}
      >
        <List aria-hidden="true" />
        <span>Índice</span>
      </PhoneIconButton>
      {open && (
        <BottomSheet
          open={open}
          onOpenChange={setOpen}
          title="Neste artigo"
          detents={['medium', 'large']}
        >
          <TocList items={items} />
        </BottomSheet>
      )}
    </>
  );
}
