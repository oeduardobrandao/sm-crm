export type TargetMode = 'all' | 'plan' | 'workspace';

export interface TargetValue {
  target_mode: TargetMode;
  target_plan_ids: string[];
  target_workspace_ids: string[];
}

const TARGET_MODES: TargetMode[] = ['all', 'plan', 'workspace'];
const MODE_LABEL: Record<TargetMode, string> = {
  all: 'All',
  plan: 'By Plan',
  workspace: 'By Workspace',
};

interface Option {
  id: string;
  name: string;
}

interface TargetPickerProps {
  value: TargetValue;
  plans: Option[] | undefined;
  workspaces: Option[] | undefined;
  onChange: (next: TargetValue) => void;
}

function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function Chips({
  options,
  selected,
  onToggle,
  scroll,
}: {
  options: Option[];
  selected: string[];
  onToggle: (id: string) => void;
  scroll?: boolean;
}) {
  return (
    <div className={`flex flex-wrap gap-2 ${scroll ? 'max-h-40 overflow-y-auto' : ''}`}>
      {options.map((o) => {
        const on = selected.includes(o.id);
        return (
          <label
            key={o.id}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
              on
                ? 'bg-primary/20 text-primary border border-primary/30'
                : 'bg-secondary text-muted-foreground border border-transparent'
            }`}
          >
            <input
              type="checkbox"
              className="hidden"
              checked={on}
              onChange={() => onToggle(o.id)}
            />
            {o.name}
          </label>
        );
      })}
    </div>
  );
}

/** Radios All / By Plan / By Workspace + chips. Compartilhado entre Banners e Popups. */
export function TargetPicker({ value, plans, workspaces, onChange }: TargetPickerProps) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
        Target
      </label>
      <div className="flex gap-3 mb-3">
        {TARGET_MODES.map((m) => (
          <label key={m} className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="radio"
              name="target_mode"
              value={m}
              checked={value.target_mode === m}
              onChange={() =>
                onChange({ target_mode: m, target_plan_ids: [], target_workspace_ids: [] })
              }
            />
            {MODE_LABEL[m]}
          </label>
        ))}
      </div>

      {value.target_mode === 'plan' && plans && (
        <Chips
          options={plans}
          selected={value.target_plan_ids}
          onToggle={(id) =>
            onChange({ ...value, target_plan_ids: toggle(value.target_plan_ids, id) })
          }
        />
      )}

      {value.target_mode === 'workspace' && workspaces && (
        <Chips
          scroll
          options={workspaces}
          selected={value.target_workspace_ids}
          onToggle={(id) =>
            onChange({ ...value, target_workspace_ids: toggle(value.target_workspace_ids, id) })
          }
        />
      )}
    </div>
  );
}
