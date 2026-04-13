import { sanitizeUrl } from '../../router';

interface PortalPropertyDef {
  id: number;
  name: string;
  type: string;
  config: Record<string, unknown>;
  display_order: number;
}

interface PortalSelectOption {
  id: string;
  label: string;
  color: string;
}

interface PortalPropertyValue {
  property_definition_id: number;
  value: unknown;
}

interface PortalWorkflowSelectOption {
  option_id: string;
  property_definition_id: number;
  label: string;
  color: string;
}

interface Props {
  definitions: PortalPropertyDef[];
  values: PortalPropertyValue[]; // pre-filtered to this post's values by the parent
  selectOptions: PortalWorkflowSelectOption[]; // per-workflow additions
}

function renderPortalValue(
  def: PortalPropertyDef,
  value: unknown,
  selectOptions: PortalWorkflowSelectOption[]
): React.ReactNode {
  if (value == null || value === '') {
    return <span style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: '0.85rem' }}>—</span>;
  }

  const allOptions: PortalSelectOption[] = [
    ...((def.config.options as PortalSelectOption[]) ?? []),
    ...selectOptions
      .filter(o => o.property_definition_id === def.id)
      .map(o => ({ id: o.option_id, label: o.label, color: o.color })),
  ];

  if (def.type === 'checkbox') {
    return <span style={{ fontSize: '0.85rem' }}>{(value as boolean) ? '✓ Sim' : '✗ Não'}</span>;
  }

  if (def.type === 'select' || def.type === 'status') {
    const opt = allOptions.find(o => o.id === value);
    if (!opt) return <span style={{ fontSize: '0.85rem' }}>{String(value)}</span>;
    return (
      <span style={{
        fontSize: '0.75rem', padding: '2px 10px', borderRadius: 12,
        background: opt.color + '22', color: opt.color, border: `1px solid ${opt.color}55`,
      }}>
        {opt.label}
      </span>
    );
  }

  if (def.type === 'multiselect') {
    const selected = (value as string[])
      .map(id => allOptions.find(o => o.id === id))
      .filter(Boolean) as PortalSelectOption[];
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {selected.map(opt => (
          <span key={opt.id} style={{
            fontSize: '0.75rem', padding: '2px 10px', borderRadius: 12,
            background: opt.color + '22', color: opt.color, border: `1px solid ${opt.color}55`,
          }}>
            {opt.label}
          </span>
        ))}
      </div>
    );
  }

  if (def.type === 'date') {
    const raw = String(value);
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    const formatted = m ? `${m[3]}/${m[2]}/${m[1]}` : raw;
    return <span style={{ fontSize: '0.85rem' }}>{formatted}</span>;
  }

  if (def.type === 'url') {
    const safeUrl = sanitizeUrl(value as string);
    return (
      <a href={safeUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.85rem', color: '#3b82f6' }}>
        {(value as string).replace(/^https?:\/\//, '')}
      </a>
    );
  }

  if (def.type === 'number') {
    const fmt = (def.config.format as string) ?? 'integer';
    const num = Number(value);
    if (fmt === 'currency') return <span style={{ fontSize: '0.85rem' }}>{num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>;
    if (fmt === 'percentage') return <span style={{ fontSize: '0.85rem' }}>{num}%</span>;
    return <span style={{ fontSize: '0.85rem' }}>{String(value)}</span>;
  }

  if (def.type === 'person') {
    const v = value as { name?: string };
    return <span style={{ fontSize: '0.85rem' }}>{v.name ?? '—'}</span>;
  }

  return <span style={{ fontSize: '0.85rem' }}>{String(value)}</span>;
}

export function PortalPropertyTable({ definitions, values, selectOptions }: Props) {
  if (definitions.length === 0) return null;

  const sorted = [...definitions].sort((a, b) => a.display_order - b.display_order);

  return (
    <div style={{
      background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8,
      padding: '10px 14px', marginBottom: 14,
    }}>
      {sorted.map(def => {
        const pv = values.find(v => v.property_definition_id === def.id);
        return (
          <div
            key={def.id}
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 12,
              padding: '5px 0', borderBottom: '1px solid #f1f5f9', fontSize: '0.9rem',
            }}
          >
            <div style={{ width: '40%', color: '#64748b', fontSize: '0.82rem', paddingTop: 2, flexShrink: 0 }}>
              {def.name}
            </div>
            <div style={{ flex: 1 }}>
              {renderPortalValue(def, pv?.value ?? null, selectOptions)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
