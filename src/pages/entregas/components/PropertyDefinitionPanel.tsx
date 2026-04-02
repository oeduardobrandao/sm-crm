import { useState } from 'react';
import { X, Type, Hash, ChevronDown, Calendar, User, CheckSquare, Link, Mail, Phone, Clock, Tag, List } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  createPropertyDefinition, updatePropertyDefinition,
  type PropertyType, type TemplatePropertyDefinition, type SelectOption,
} from '../../../store';

const TYPE_ITEMS: { type: PropertyType; label: string; icon: React.ReactNode }[] = [
  { type: 'text',         label: 'Texto',          icon: <Type className="h-4 w-4" /> },
  { type: 'number',       label: 'Número',          icon: <Hash className="h-4 w-4" /> },
  { type: 'select',       label: 'Seleção',         icon: <ChevronDown className="h-4 w-4" /> },
  { type: 'multiselect',  label: 'Multi-seleção',   icon: <List className="h-4 w-4" /> },
  { type: 'status',       label: 'Status',          icon: <Tag className="h-4 w-4" /> },
  { type: 'date',         label: 'Data',            icon: <Calendar className="h-4 w-4" /> },
  { type: 'person',       label: 'Pessoa',          icon: <User className="h-4 w-4" /> },
  { type: 'checkbox',     label: 'Checkbox',        icon: <CheckSquare className="h-4 w-4" /> },
  { type: 'url',          label: 'URL',             icon: <Link className="h-4 w-4" /> },
  { type: 'email',        label: 'Email',           icon: <Mail className="h-4 w-4" /> },
  { type: 'phone',        label: 'Telefone',        icon: <Phone className="h-4 w-4" /> },
  { type: 'created_time', label: 'Criado em',       icon: <Clock className="h-4 w-4" /> },
];

const PRESET_COLORS = ['#94a3b8','#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#8b5cf6','#ec4899'];

interface Props {
  templateId: number;
  definition?: TemplatePropertyDefinition; // provided when editing
  onSave: () => void;
  onClose: () => void;
}

export function PropertyDefinitionPanel({ templateId, definition, onSave, onClose }: Props) {
  const isEditing = !!definition?.id;
  const [selectedType, setSelectedType] = useState<PropertyType>(definition?.type ?? 'text');
  const [name, setName] = useState(definition?.name ?? '');
  const [portalVisible, setPortalVisible] = useState(definition?.portal_visible ?? false);
  const [saving, setSaving] = useState(false);

  // Options state for select / multiselect / status
  const [options, setOptions] = useState<SelectOption[]>(() => {
    if (definition?.config && (definition.type === 'select' || definition.type === 'multiselect' || definition.type === 'status')) {
      return (definition.config.options as SelectOption[]) ?? [];
    }
    if (selectedType === 'status') {
      return [
        { id: crypto.randomUUID(), label: 'Não iniciado', color: '#94a3b8' },
        { id: crypto.randomUUID(), label: 'Em andamento', color: '#3b82f6' },
        { id: crypto.randomUUID(), label: 'Concluído', color: '#22c55e' },
      ];
    }
    return [];
  });
  const [newOptionLabel, setNewOptionLabel] = useState('');
  const [newOptionColor, setNewOptionColor] = useState('#3b82f6');

  // Number format
  const [numberFormat, setNumberFormat] = useState<string>(
    (definition?.config?.format as string) ?? 'integer'
  );

  const buildConfig = (): Record<string, unknown> => {
    if (selectedType === 'select' || selectedType === 'multiselect' || selectedType === 'status') {
      return { options };
    }
    if (selectedType === 'number') {
      return { format: numberFormat };
    }
    if (selectedType === 'person') {
      return { allow_multiple: false };
    }
    return {};
  };

  const handleAddOption = () => {
    const label = newOptionLabel.trim();
    if (!label) return;
    setOptions(prev => [...prev, { id: crypto.randomUUID(), label, color: newOptionColor }]);
    setNewOptionLabel('');
  };

  const handleRemoveOption = (id: string) => {
    setOptions(prev => prev.filter(o => o.id !== id));
  };

  const handleTypeChange = (type: PropertyType) => {
    setSelectedType(type);
    if (type === 'status' && options.length === 0) {
      setOptions([
        { id: crypto.randomUUID(), label: 'Não iniciado', color: '#94a3b8' },
        { id: crypto.randomUUID(), label: 'Em andamento', color: '#3b82f6' },
        { id: crypto.randomUUID(), label: 'Concluído', color: '#22c55e' },
      ]);
    }
  };

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) { toast.error('Nome da propriedade é obrigatório.'); return; }
    if ((selectedType === 'select' || selectedType === 'multiselect' || selectedType === 'status') && options.length === 0) {
      toast.error('Adicione pelo menos uma opção.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: trimmedName,
        type: selectedType,
        config: buildConfig(),
        portal_visible: portalVisible,
        display_order: definition?.display_order ?? Date.now(),
      };
      if (isEditing) {
        await updatePropertyDefinition(definition!.id!, payload);
        toast.success('Propriedade atualizada!');
      } else {
        await createPropertyDefinition(templateId, payload);
        toast.success('Propriedade criada!');
      }
      onSave();
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erro ao salvar propriedade');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'stretch', justifyContent: 'flex-end',
    }}>
      {/* Overlay */}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)' }} onClick={onClose} />

      {/* Panel */}
      <div style={{
        position: 'relative', zIndex: 1, width: 520, maxWidth: '95vw',
        background: 'var(--card-bg, white)', boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>
            {isEditing ? 'Editar propriedade' : 'Nova propriedade'}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body: two columns */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Left: type list */}
          <div style={{ width: 160, borderRight: '1px solid var(--border-color)', overflowY: 'auto', padding: '0.5rem' }}>
            <p style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0.25rem 0.5rem', margin: '0 0 0.25rem' }}>Tipo</p>
            {TYPE_ITEMS.map(item => (
              <button
                key={item.type}
                onClick={() => handleTypeChange(item.type)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 8px',
                  border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.82rem', textAlign: 'left',
                  background: selectedType === item.type ? 'var(--primary-light, #eff6ff)' : 'transparent',
                  color: selectedType === item.type ? 'var(--primary, #1d4ed8)' : 'inherit',
                  fontWeight: selectedType === item.type ? 600 : 400,
                  marginBottom: 1,
                }}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>

          {/* Right: config */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.25rem' }}>
            <div style={{ marginBottom: '1rem' }}>
              <Label style={{ fontSize: '0.8rem' }}>Nome da propriedade *</Label>
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={`Ex: ${TYPE_ITEMS.find(t => t.type === selectedType)?.label}`}
                style={{ marginTop: 4 }}
                autoFocus
              />
            </div>

            {/* Type-specific config */}
            {(selectedType === 'select' || selectedType === 'multiselect' || selectedType === 'status') && (
              <div style={{ marginBottom: '1rem' }}>
                <Label style={{ fontSize: '0.8rem' }}>Opções</Label>
                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {options.map(opt => (
                    <div key={opt.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                      <span style={{ width: 14, height: 14, borderRadius: '50%', background: opt.color, flexShrink: 0, display: 'inline-block' }} />
                      <span style={{ flex: 1, fontSize: '0.85rem' }}>{opt.label}</span>
                      <button
                        onClick={() => handleRemoveOption(opt.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
                    {PRESET_COLORS.map(c => (
                      <button
                        key={c}
                        onClick={() => setNewOptionColor(c)}
                        style={{
                          width: 16, height: 16, borderRadius: '50%', background: c, border: newOptionColor === c ? '2px solid #1d4ed8' : '2px solid transparent',
                          cursor: 'pointer', padding: 0,
                        }}
                      />
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Input
                    placeholder="Nome da opção"
                    value={newOptionLabel}
                    onChange={e => setNewOptionLabel(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddOption(); } }}
                    style={{ flex: 1, fontSize: '0.82rem' }}
                  />
                  <Button variant="outline" size="sm" onClick={handleAddOption}>+ Adicionar</Button>
                </div>
              </div>
            )}

            {selectedType === 'number' && (
              <div style={{ marginBottom: '1rem' }}>
                <Label style={{ fontSize: '0.8rem' }}>Formato</Label>
                <select
                  className="drawer-select"
                  value={numberFormat}
                  onChange={e => setNumberFormat(e.target.value)}
                  style={{ marginTop: 4, width: '100%' }}
                >
                  <option value="integer">Inteiro</option>
                  <option value="decimal">Decimal</option>
                  <option value="percentage">Percentual (%)</option>
                  <option value="currency">Moeda (R$)</option>
                </select>
              </div>
            )}

            {selectedType === 'created_time' && (
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                Preenchido automaticamente com a data de criação do post.
              </p>
            )}

            {/* Portal visibility */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.75rem 0', borderTop: '1px solid var(--border-color)', marginTop: 'auto' }}>
              <Checkbox
                id="portal-visible"
                checked={portalVisible}
                onCheckedChange={v => setPortalVisible(v as boolean)}
              />
              <label htmlFor="portal-visible" style={{ fontSize: '0.85rem', cursor: 'pointer' }}>
                Visível no portal do cliente
              </label>
            </div>

            {!isEditing && (
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                Esta propriedade será adicionada a todos os posts deste template.
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Salvando…' : isEditing ? 'Salvar alterações' : 'Criar propriedade'}
          </Button>
        </div>
      </div>
    </div>
  );
}
