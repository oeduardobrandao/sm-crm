import { useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, Plus, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { BottomSheet } from '@/components/mobile/BottomSheet';
import { CheckList } from '@/components/mobile/CheckList';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import { addTarefaTag, type TarefaTag } from '../../../store';

// Same preset palette as the entregas property system (PropertyDefinitionPanel).
export const TAG_PRESET_COLORS = [
  '#94a3b8',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
];

export function TagPill({ tag, small }: { tag: TarefaTag; small?: boolean }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: small ? '0.05rem 0.45rem' : '0.15rem 0.6rem',
        borderRadius: '999px',
        fontSize: small ? '0.62rem' : '0.7rem',
        fontWeight: 600,
        whiteSpace: 'nowrap',
        background: tag.cor + '22',
        color: tag.cor,
        border: `1px solid ${tag.cor}55`,
      }}
    >
      {tag.nome}
    </span>
  );
}

interface TagPickerProps {
  tags: TarefaTag[];
  selectedIds: number[];
  onSelectedChange: (ids: number[]) => void;
  /** Called after a new tag is created so the parent can refresh the tag list. */
  onTagCreated?: () => void;
  /** `phone`: a grouped row that opens a sheet (checkmark list + new tag), for the phone form. */
  layout?: 'default' | 'phone';
}

/** Multi-select tag dropdown with inline "new tag" creation. */
export function TagPicker({
  tags,
  selectedIds,
  onSelectedChange,
  onTagCreated,
  layout = 'default',
}: TagPickerProps) {
  const { t } = useTranslation('tasksForm');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(TAG_PRESET_COLORS[5]);
  const [creating, setCreating] = useState(false);

  const selectedTags = tags.filter((tag) => tag.id != null && selectedIds.includes(tag.id));

  const toggle = (id: number) => {
    onSelectedChange(
      selectedIds.includes(id) ? selectedIds.filter((v) => v !== id) : [...selectedIds, id],
    );
  };

  const handleCreate = async () => {
    const nome = newName.trim();
    if (!nome || creating) return;
    setCreating(true);
    try {
      const tag = await addTarefaTag({ nome, cor: newColor });
      onSelectedChange([...selectedIds, tag.id!]);
      setNewName('');
      onTagCreated?.();
    } catch {
      toast.error(t('tagPicker.createError'));
    } finally {
      setCreating(false);
    }
  };

  if (layout === 'phone') {
    const summary =
      selectedTags.length === 0
        ? t('tagPicker.none')
        : selectedTags.length === 1
          ? selectedTags[0].nome
          : t('tagPicker.summaryMore', {
              name: selectedTags[0].nome,
              more: selectedTags.length - 1,
            });
    return (
      <>
        <Cell
          label={t('tagPicker.tags')}
          icon={<Tag aria-hidden="true" />}
          value={summary}
          chevron
          aria-haspopup="dialog"
          onClick={() => setSheetOpen(true)}
        />
        <BottomSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          title={t('tagPicker.tags')}
          detents={['large']}
        >
          <div className="phone-tar-sheet-body">
            {tags.length === 0 ? (
              <p className="phone-tar-footnote">{t('tagPicker.empty')}</p>
            ) : (
              <CheckList<number>
                multiple
                aria-label={t('tagPicker.tags')}
                options={tags
                  .filter((tag) => tag.id != null)
                  .map((tag) => ({
                    value: tag.id!,
                    label: tag.nome,
                    icon: (
                      <span
                        className="phone-tar-card__dot"
                        style={{ background: tag.cor }}
                        aria-hidden="true"
                      />
                    ),
                  }))}
                value={selectedIds}
                onChange={onSelectedChange}
              />
            )}
            <GroupedList header={t('tagPicker.newTag')}>
              <li className="phone-cell">
                <div className="phone-tar-form__tag-create">
                  <input
                    aria-label={t('tagPicker.newTag')}
                    placeholder={t('tagPicker.newTagPlaceholder')}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleCreate();
                      }
                    }}
                  />
                  <div
                    className="phone-tar-form__colors"
                    role="group"
                    aria-label={t('tagPicker.tagColor')}
                  >
                    {TAG_PRESET_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        aria-label={t('tagPicker.colorOption', { color: c })}
                        aria-pressed={newColor === c}
                        className="phone-tar-form__color"
                        style={{ background: c }}
                        onClick={() => setNewColor(c)}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    className="phone-tar-ink-btn"
                    disabled={!newName.trim() || creating}
                    onClick={handleCreate}
                  >
                    <Plus aria-hidden="true" /> {t('tagPicker.create')}
                  </button>
                </div>
              </li>
            </GroupedList>
          </div>
        </BottomSheet>
      </>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-9 w-full justify-between px-3 text-xs font-normal"
        >
          <span className="flex items-center gap-1.5 truncate">
            <Tag className="h-3.5 w-3.5 opacity-60 shrink-0" />
            {selectedTags.length === 0 ? (
              <span className="text-muted-foreground">{t('tagPicker.select')}</span>
            ) : (
              <span className="flex items-center gap-1 overflow-hidden">
                {selectedTags.slice(0, 3).map((tag) => (
                  <TagPill key={tag.id} tag={tag} small />
                ))}
                {selectedTags.length > 3 && (
                  <span className="text-muted-foreground">+{selectedTags.length - 3}</span>
                )}
              </span>
            )}
          </span>
          <ChevronDown className="h-3.5 w-3.5 opacity-60 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[240px]">
        {tags.length === 0 && (
          <DropdownMenuItem disabled className="text-xs">
            {t('tagPicker.empty')}
          </DropdownMenuItem>
        )}
        {tags.map((tag) => {
          const isChecked = tag.id != null && selectedIds.includes(tag.id);
          return (
            <DropdownMenuItem
              key={tag.id}
              role="menuitemcheckbox"
              aria-checked={isChecked}
              className="gap-2 text-xs"
              onSelect={(e) => {
                e.preventDefault();
                if (tag.id != null) toggle(tag.id);
              }}
            >
              <span
                aria-hidden
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border ${
                  isChecked
                    ? 'border-[var(--primary-color)] bg-[var(--primary-color)]'
                    : 'border-input'
                }`}
              >
                {isChecked && <Check className="h-3 w-3 text-black" strokeWidth={3} />}
              </span>
              <TagPill tag={tag} small />
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <div className="px-2 py-2 flex flex-col gap-2" onKeyDown={(e) => e.stopPropagation()}>
          <Input
            placeholder={t('tagPicker.newTagPlaceholder')}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleCreate();
              }
            }}
            className="h-8 !text-xs mb-0"
          />
          <div className="flex items-center gap-1.5">
            {TAG_PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={t('tagPicker.colorOption', { color: c })}
                onClick={() => setNewColor(c)}
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  background: c,
                  border: newColor === c ? '2px solid var(--text-main)' : '2px solid transparent',
                  cursor: 'pointer',
                }}
              />
            ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs ml-auto"
              disabled={!newName.trim() || creating}
              onClick={handleCreate}
            >
              <Plus className="h-3 w-3" /> {t('tagPicker.create')}
            </Button>
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
