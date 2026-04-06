import { useState, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { sanitizeUrl } from '../../../router';
import {
  upsertPostPropertyValue, createWorkflowSelectOption, getWorkflowSelectOptions,
  type TemplatePropertyDefinition, type SelectOption, type Membro,
} from '../../../store';

interface Props {
  definition: TemplatePropertyDefinition;
  value: unknown;
  postId: number;
  workflowId: number;
  membros: Membro[];
  readOnly?: boolean;
}

function formatDisplayValue(definition: TemplatePropertyDefinition, value: unknown): string {
  if (value == null) return '';
  if (definition.type === 'checkbox') return (value as boolean) ? 'Sim' : 'Não';
  if (definition.type === 'date') {
    try {
      return new Date(value as string).toLocaleDateString('pt-BR');
    } catch { return value as string; }
  }
  if (definition.type === 'number') {
    const fmt = (definition.config.format as string) ?? 'integer';
    const num = Number(value);
    if (fmt === 'currency') return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    if (fmt === 'percentage') return `${num}%`;
    if (fmt === 'decimal') return num.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    return String(Math.round(num));
  }
  if (definition.type === 'person') {
    const v = value as { membro_id?: number; name?: string };
    return v.name ?? '';
  }
  return String(value);
}

export function PropertyValue({ definition, value: initialValue, postId, workflowId, membros, readOnly }: Props) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [localValue, setLocalValue] = useState<unknown>(initialValue);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [newOptionLabel, setNewOptionLabel] = useState('');

  useEffect(() => { setLocalValue(initialValue); }, [initialValue]);

  // Fetch per-workflow select options (merged with template options)
  const { data: workflowOptions = [] } = useQuery({
    queryKey: ['workflow-select-options', workflowId, definition.id],
    queryFn: () => getWorkflowSelectOptions(workflowId, definition.id!),
    enabled: !!definition.id && (definition.type === 'select' || definition.type === 'multiselect' || definition.type === 'status'),
  });

  const allOptions: SelectOption[] = [
    ...((definition.config.options as SelectOption[]) ?? []),
    ...workflowOptions.map(wo => ({ id: wo.option_id, label: wo.label, color: wo.color })),
  ];

  const save = (val: unknown) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await upsertPostPropertyValue(postId, definition.id!, val);
        qc.invalidateQueries({ queryKey: ['workflow-posts-with-props'] });
      } catch { toast.error('Erro ao salvar propriedade'); }
    }, 1500);
  };

  const handleChange = (val: unknown) => {
    setLocalValue(val);
    save(val);
  };

  const handleAddOption = async () => {
    const label = newOptionLabel.trim();
    if (!label) return;
    try {
      const created = await createWorkflowSelectOption(workflowId, definition.id!, label, '#94a3b8');
      qc.invalidateQueries({ queryKey: ['workflow-select-options', workflowId, definition.id] });
      // For select, auto-select the new option
      if (definition.type === 'select' || definition.type === 'status') {
        handleChange(created.option_id);
      } else {
        handleChange([...((localValue as string[]) ?? []), created.option_id]);
      }
      setNewOptionLabel('');
    } catch { toast.error('Erro ao criar opção'); }
  };

  const renderInput = () => {
    if (definition.type === 'created_time') {
      // Computed — not editable
      return null;
    }

    if (definition.type === 'text' || definition.type === 'url' || definition.type === 'email' || definition.type === 'phone') {
      return (
        <input
          className="drawer-input"
          style={{ fontSize: '0.85rem', padding: '3px 6px' }}
          type={definition.type === 'email' ? 'email' : definition.type === 'url' ? 'url' : definition.type === 'phone' ? 'tel' : 'text'}
          value={(localValue as string) ?? ''}
          placeholder={`Inserir ${definition.name.toLowerCase()}…`}
          onChange={e => handleChange(e.target.value)}
          onBlur={() => setEditing(false)}
          autoFocus
        />
      );
    }

    if (definition.type === 'number') {
      return (
        <input
          className="drawer-input"
          style={{ fontSize: '0.85rem', padding: '3px 6px' }}
          type="number"
          value={(localValue as number) ?? ''}
          placeholder="0"
          onChange={e => handleChange(e.target.value === '' ? null : Number(e.target.value))}
          onBlur={() => setEditing(false)}
          autoFocus
        />
      );
    }

    if (definition.type === 'date') {
      return (
        <input
          className="drawer-input"
          style={{ fontSize: '0.85rem', padding: '3px 6px' }}
          type="date"
          value={(localValue as string) ?? ''}
          onChange={e => { handleChange(e.target.value); setEditing(false); }}
          autoFocus
        />
      );
    }

    if (definition.type === 'checkbox') {
      return (
        <input
          type="checkbox"
          checked={!!localValue}
          onChange={e => { handleChange(e.target.checked); setEditing(false); }}
          style={{ cursor: 'pointer' }}
          autoFocus
        />
      );
    }

    if (definition.type === 'select' || definition.type === 'status') {
      return (
        <div>
          <select
            className="drawer-select"
            style={{ fontSize: '0.82rem', padding: '3px 6px' }}
            value={(localValue as string) ?? ''}
            onChange={e => { handleChange(e.target.value || null); setEditing(false); }}
            autoFocus
          >
            <option value="">Nenhum</option>
            {allOptions.map(opt => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
          <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
            <input
              className="drawer-input"
              placeholder="+ Nova opção"
              value={newOptionLabel}
              onChange={e => setNewOptionLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddOption(); } }}
              style={{ fontSize: '0.75rem', padding: '2px 6px' }}
            />
          </div>
        </div>
      );
    }

    if (definition.type === 'multiselect') {
      const selected = (localValue as string[]) ?? [];
      return (
        <div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
            {allOptions.map(opt => {
              const isSelected = selected.includes(opt.id);
              return (
                <button
                  key={opt.id}
                  onClick={() => {
                    const next = isSelected ? selected.filter(id => id !== opt.id) : [...selected, opt.id];
                    handleChange(next);
                  }}
                  style={{
                    padding: '2px 8px', borderRadius: 12, fontSize: '0.75rem', cursor: 'pointer',
                    background: isSelected ? opt.color : 'transparent',
                    color: isSelected ? 'white' : 'inherit',
                    border: `1px solid ${opt.color}`,
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              className="drawer-input"
              placeholder="+ Nova opção"
              value={newOptionLabel}
              onChange={e => setNewOptionLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddOption(); } }}
              style={{ fontSize: '0.75rem', padding: '2px 6px' }}
            />
          </div>
        </div>
      );
    }

    if (definition.type === 'person') {
      const val = (localValue as { membro_id?: number; name?: string }) ?? {};
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <select
            className="drawer-select"
            style={{ fontSize: '0.82rem', padding: '3px 6px' }}
            value={val.membro_id ?? ''}
            onChange={e => {
              if (e.target.value) {
                const m = membros.find(m => m.id === Number(e.target.value));
                handleChange({ membro_id: Number(e.target.value), name: m?.nome ?? '' });
              } else {
                handleChange(null);
              }
              setEditing(false);
            }}
          >
            <option value="">Selecionar membro…</option>
            {membros.map(m => (
              <option key={m.id} value={m.id}>{m.nome}</option>
            ))}
          </select>
          <input
            className="drawer-input"
            placeholder="Ou nome externo…"
            value={val.membro_id ? '' : (val.name ?? '')}
            onChange={e => handleChange({ name: e.target.value })}
            style={{ fontSize: '0.82rem', padding: '3px 6px' }}
            onBlur={() => setEditing(false)}
          />
        </div>
      );
    }

    return null;
  };

  const renderDisplay = () => {
    if (definition.type === 'created_time') {
      return <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Auto</span>;
    }
    if (localValue == null || localValue === '' || (Array.isArray(localValue) && localValue.length === 0)) {
      return <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Vazio</span>;
    }
    if (definition.type === 'checkbox') {
      return <span style={{ fontSize: '0.82rem' }}>{(localValue as boolean) ? '☑ Sim' : '☐ Não'}</span>;
    }
    if (definition.type === 'select' || definition.type === 'status') {
      const opt = allOptions.find(o => o.id === localValue);
      if (!opt) return <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Vazio</span>;
      return (
        <span style={{
          fontSize: '0.75rem', padding: '2px 8px', borderRadius: 12,
          background: opt.color + '22', color: opt.color, border: `1px solid ${opt.color}55`,
        }}>
          {opt.label}
        </span>
      );
    }
    if (definition.type === 'multiselect') {
      const selected = (localValue as string[]).map(id => allOptions.find(o => o.id === id)).filter(Boolean) as SelectOption[];
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {selected.map(opt => (
            <span key={opt.id} style={{
              fontSize: '0.75rem', padding: '2px 8px', borderRadius: 12,
              background: opt.color + '22', color: opt.color, border: `1px solid ${opt.color}55`,
            }}>
              {opt.label}
            </span>
          ))}
        </div>
      );
    }
    if (definition.type === 'url') {
      const safeUrl = sanitizeUrl(localValue as string);
      return (
        <a href={safeUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.82rem', color: 'var(--primary)' }}>
          {(localValue as string).replace(/^https?:\/\//, '')}
        </a>
      );
    }
    return <span style={{ fontSize: '0.82rem' }}>{formatDisplayValue(definition, localValue)}</span>;
  };

  const isEditable = definition.type !== 'created_time' && !readOnly;

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 8,
      padding: '5px 0', borderBottom: '1px solid var(--border-color, #f1f5f9)',
      fontSize: '0.85rem',
    }}>
      <div style={{ width: '40%', color: 'var(--text-muted)', paddingTop: 3, flexShrink: 0, fontSize: '0.82rem' }}>
        {definition.name}
      </div>
      <div style={{ flex: 1 }}>
        {editing && isEditable
          ? renderInput()
          : (
            <div
              onClick={() => isEditable && setEditing(true)}
              style={{ cursor: isEditable ? 'pointer' : 'default', minHeight: 22, borderRadius: 4, padding: '2px 4px', transition: 'background 0.1s' }}
              onMouseEnter={e => isEditable && ((e.currentTarget as HTMLDivElement).style.background = 'var(--hover-bg, #f1f5f9)')}
              onMouseLeave={e => ((e.currentTarget as HTMLDivElement).style.background = 'transparent')}
            >
              {renderDisplay()}
            </div>
          )
        }
      </div>
    </div>
  );
}
