import { Fragment, useState, type ReactNode, type RefObject } from 'react';
import { ChevronLeft } from 'lucide-react';
import { BottomSheet } from './BottomSheet';
import { CheckList } from './CheckList';
import { Chip, ChipRow } from './ChipRow';
import { Cell, GroupedList } from './GroupedList';

/** A short list shown as toggle chips (situação, prazo, tipo). */
export interface FilterChipsSection {
  type: 'chips';
  key: string;
  label: string;
  chips: { key: string; label: string; selected: boolean; onToggle: () => void }[];
  /** Under the chips (e.g. the date fields of a "Personalizado" chip). */
  after?: ReactNode;
}

/** A long list: a row with the current pick that drills into a checkmark list. */
export interface FilterList {
  key: string;
  title: string;
  /** The "nothing picked" row ("Todos", "Todas"); also the row's value when empty. */
  allLabel: string;
  options: { value: string | number; label: string }[];
  selected: (string | number)[];
  onChange: (next: (string | number)[]) => void;
}

/** Drill-in rows, together in one grouped list. */
export interface FilterListsSection {
  type: 'lists';
  key: string;
  lists: FilterList[];
}

/** Anything else, as is. */
export interface FilterCustomSection {
  type: 'custom';
  key: string;
  content: ReactNode;
}

export type FilterSection = FilterChipsSection | FilterListsSection | FilterCustomSection;

export interface PhoneFiltersSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: ReactNode;
  sections: FilterSection[];
  /** Active filter count: "Limpar" is disabled at 0. */
  activeCount: number;
  onClear: () => void;
  /** What the screen shows with the current filters ("Ver 6"). */
  resultCount: number;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

function summaryOf(list: FilterList): string {
  const picked = list.options.filter((o) => list.selected.includes(o.value));
  if (picked.length === 0) return list.allLabel;
  return picked.length === 1 ? picked[0].label : `${picked[0].label} +${picked.length - 1}`;
}

/**
 * Filters on phones (EntregasFiltros mockup): a sheet with Limpar / Ver N, chip groups
 * for the short lists and drill-in checkmark lists for the long ones. Changes apply as
 * they're made, so "Ver N" is the real count. The page owns the filter state and builds
 * the sections; the sheet owns only which drill-in page is showing.
 */
export function PhoneFiltersSheet({
  open,
  onOpenChange,
  title = 'Filtros',
  description,
  sections,
  activeCount,
  onClear,
  resultCount,
  returnFocusRef,
}: PhoneFiltersSheetProps) {
  const [page, setPage] = useState<string | null>(null);
  const handleOpenChange = (next: boolean) => {
    if (!next) setPage(null);
    onOpenChange(next);
  };
  const lists = sections.flatMap((s) => (s.type === 'lists' ? s.lists : []));
  const pageList = page ? lists.find((l) => l.key === page) : undefined;

  return (
    <BottomSheet
      open={open}
      onOpenChange={handleOpenChange}
      title={title}
      description={description}
      detents={['large']}
      returnFocusRef={returnFocusRef}
      headerLeading={
        pageList ? (
          <button type="button" className="phone-text-button" onClick={() => setPage(null)}>
            <ChevronLeft aria-hidden="true" />
            {title}
          </button>
        ) : (
          <button
            type="button"
            className="phone-text-button"
            disabled={activeCount === 0}
            onClick={onClear}
          >
            Limpar
          </button>
        )
      }
      headerTrailing={
        <button
          type="button"
          className="phone-text-button phone-text-button--strong"
          onClick={() => handleOpenChange(false)}
        >
          Ver {resultCount}
        </button>
      }
    >
      {pageList ? (
        <div className="phone-filters">
          <CheckList
            multiple
            header={pageList.title}
            emptyOption={{ label: pageList.allLabel }}
            options={pageList.options}
            value={pageList.selected}
            onChange={pageList.onChange}
          />
        </div>
      ) : (
        <div className="phone-filters">
          {sections.map((section) => {
            if (section.type === 'chips') {
              return (
                <section key={section.key} className="phone-filters__group">
                  <h3 className="phone-filters__label">{section.label}</h3>
                  <ChipRow aria-label={section.label} className="phone-filters__chips">
                    {section.chips.map((chip) => (
                      <Chip
                        key={chip.key}
                        label={chip.label}
                        selected={chip.selected}
                        onClick={chip.onToggle}
                      />
                    ))}
                  </ChipRow>
                  {section.after}
                </section>
              );
            }
            if (section.type === 'lists') {
              return (
                <GroupedList key={section.key}>
                  {section.lists.map((list) => (
                    <Cell
                      key={list.key}
                      label={list.title}
                      value={summaryOf(list)}
                      chevron
                      onClick={() => setPage(list.key)}
                    />
                  ))}
                </GroupedList>
              );
            }
            return <Fragment key={section.key}>{section.content}</Fragment>;
          })}
        </div>
      )}
    </BottomSheet>
  );
}
