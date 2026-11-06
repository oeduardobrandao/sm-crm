import { useState, type ReactNode } from 'react';
import { Check, Search } from 'lucide-react';
import { normalize } from './normalizeText';
import { Cell, GroupedList } from './GroupedList';

export type CheckListValue = string | number;

export interface CheckListOption<T extends CheckListValue = CheckListValue> {
  value: T;
  label: ReactNode;
  /** Text the search matches. Defaults to `label` when it is a string. */
  searchText?: string;
  subtitle?: ReactNode;
  icon?: ReactNode;
  iconColor?: string;
  disabled?: boolean;
  /** Section title. Options with the same section render together, in first-seen order. */
  section?: string;
}

interface CheckListCommon<T extends CheckListValue> {
  options: CheckListOption<T>[];
  /** Title of the list when the options have no sections. */
  header?: ReactNode;
  /** Accessible name when there is no visible header. */
  'aria-label'?: string;
  /**
   * A first row that stands for "nothing picked" ("Todos", "Sem responsável"). Single
   * select: picks `null`. Multi select: clears the selection.
   */
  emptyOption?: { label: ReactNode };
  /** Shows a search field above the list. */
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Shown when the search matches nothing. */
  noResultsText?: string;
}

export interface CheckListSingleProps<T extends CheckListValue> extends CheckListCommon<T> {
  multiple?: false;
  value: T | null;
  onChange: (value: T | null) => void;
  /** Runs after a pick (PickerSheet closes itself here). */
  onPicked?: () => void;
}

export interface CheckListMultiProps<T extends CheckListValue> extends CheckListCommon<T> {
  multiple: true;
  value: T[];
  onChange: (value: T[]) => void;
  onPicked?: never;
}

export type CheckListProps<T extends CheckListValue = CheckListValue> =
  | CheckListSingleProps<T>
  | CheckListMultiProps<T>;

function searchTextOf(option: CheckListOption): string {
  if (option.searchText != null) return option.searchText;
  return typeof option.label === 'string' || typeof option.label === 'number'
    ? String(option.label)
    : '';
}

const check = <Check className="phone-check" aria-hidden="true" />;

/**
 * The iOS checkmark list: one `GroupedList` per section, a check on the picked rows.
 * Single select picks and calls `onPicked`; multi select toggles in place. The body of
 * `PickerSheet` and of the filters sheet's drill-in pages.
 */
export function CheckList<T extends CheckListValue>(props: CheckListProps<T>) {
  const {
    options,
    header,
    emptyOption,
    searchable,
    searchPlaceholder = 'Buscar',
    noResultsText = 'Nenhum resultado',
    'aria-label': ariaLabel,
  } = props;
  const [query, setQuery] = useState('');
  const q = normalize(query.trim());

  const isSelected = (value: T) =>
    props.multiple ? props.value.includes(value) : props.value === value;
  const noneSelected = props.multiple ? props.value.length === 0 : props.value === null;

  const pick = (value: T) => {
    if (props.multiple) {
      props.onChange(
        props.value.includes(value)
          ? props.value.filter((v) => v !== value)
          : [...props.value, value],
      );
    } else {
      props.onChange(value);
      props.onPicked?.();
    }
  };
  const pickNone = () => {
    if (props.multiple) props.onChange([]);
    else {
      props.onChange(null);
      props.onPicked?.();
    }
  };

  const visible = q ? options.filter((o) => normalize(searchTextOf(o)).includes(q)) : options;

  const sections: { title: ReactNode; options: CheckListOption<T>[] }[] = [];
  const bySection = new Map<string, CheckListOption<T>[]>();
  for (const option of visible) {
    const key = option.section ?? '';
    let list = bySection.get(key);
    if (!list) {
      list = [];
      bySection.set(key, list);
      sections.push({ title: option.section ?? header, options: list });
    }
    list.push(option);
  }
  // The "nothing picked" row has a home even when every option was filtered out of view.
  const showEmptyOption = Boolean(emptyOption) && !q;
  if (sections.length === 0 && showEmptyOption) sections.push({ title: header, options: [] });

  return (
    <div className="phone-kit phone-check-list">
      {searchable && (
        <div className="phone-check-list__search">
          <Search aria-hidden="true" />
          <input
            type="search"
            enterKeyHint="search"
            aria-label={searchPlaceholder}
            placeholder={searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}
      {sections.length === 0 ? (
        <p className="phone-check-list__empty" role="status">
          {noResultsText}
        </p>
      ) : (
        sections.map((section, i) => (
          <GroupedList
            key={i}
            header={section.title}
            aria-label={section.title ? undefined : ariaLabel}
          >
            {i === 0 && showEmptyOption && emptyOption && (
              <Cell
                label={emptyOption.label}
                aria-pressed={noneSelected}
                accessory={noneSelected ? check : undefined}
                onClick={pickNone}
              />
            )}
            {section.options.map((o) => {
              const on = isSelected(o.value);
              return (
                <Cell
                  key={String(o.value)}
                  label={o.label}
                  subtitle={o.subtitle}
                  icon={o.icon}
                  iconColor={o.iconColor}
                  disabled={o.disabled}
                  aria-pressed={on}
                  accessory={on ? check : undefined}
                  onClick={() => pick(o.value)}
                />
              );
            })}
          </GroupedList>
        ))
      )}
    </div>
  );
}
