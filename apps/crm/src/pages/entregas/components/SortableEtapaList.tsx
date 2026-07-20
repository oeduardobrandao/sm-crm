import { Plus, Trash2, GripVertical } from 'lucide-react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  closestCenter,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EmptyStateGuide } from '@/components/help/EmptyStateGuide';
import { HelpTooltip } from '@/components/help/HelpTooltip';
import type { Membro } from '../../../store';

type ModoPrazo = 'padrao' | 'data_fixa' | 'data_entrega';

// ---- Types ----
export interface EtapaFormData {
  _id: string;
  suggestionId?: string; // stable chip identity; absent for custom/template-only rows
  nome: string;
  prazo: number;
  tipoPrazo: 'corridos' | 'uteis';
  responsavelId: number | null;
  tipo: 'padrao' | 'aprovacao_cliente';
  dataLimite: string;
}

let _etapaIdCounter = 0;
export function defaultEtapa(overrides?: Partial<EtapaFormData>): EtapaFormData {
  return {
    _id: `etapa-${++_etapaIdCounter}`,
    nome: '',
    prazo: 3,
    tipoPrazo: 'corridos',
    responsavelId: null,
    tipo: 'padrao',
    dataLimite: '',
    ...overrides,
  };
}

// ---- SortableEtapaRow component ----
function SortableEtapaRow(props: {
  id: string;
  index: number;
  nome: string;
  prazo: number;
  tipoPrazo: string;
  responsavelId: number | null;
  tipo: 'padrao' | 'aprovacao_cliente';
  dataLimite: string;
  modoPrazo: ModoPrazo;
  membros: Membro[];
  error?: string;
  onChange: (field: string, val: unknown) => void;
  onRemove: () => void;
}) {
  const {
    id,
    nome,
    prazo,
    tipoPrazo,
    responsavelId,
    tipo,
    dataLimite,
    modoPrazo,
    membros,
    error,
    onChange,
    onRemove,
  } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        display: 'flex',
        flexDirection: 'column' as const,
        gap: '0.5rem',
        marginBottom: '0.75rem',
        padding: '0.75rem',
        border:
          tipo === 'aprovacao_cliente' ? '1px solid #bfdbfe' : '1px solid var(--border-color)',
        background: tipo === 'aprovacao_cliente' ? 'rgba(59,130,246,0.06)' : undefined,
        borderRadius: '8px',
      }}
      {...attributes}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <div {...listeners} style={{ cursor: 'grab', color: 'var(--text-muted)', flexShrink: 0 }}>
          <GripVertical className="h-4 w-4" />
        </div>
        <Input
          placeholder="Nome da etapa"
          value={nome}
          onChange={(e) => onChange('nome', e.target.value)}
          style={{ flex: 1 }}
        />
        <Button
          size="icon"
          variant="ghost"
          className="text-destructive"
          onClick={onRemove}
          style={{ flexShrink: 0 }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      {modoPrazo === 'data_fixa' ? (
        <div className="space-y-1">
          <Label style={{ fontSize: '0.75rem' }}>Data limite</Label>
          <Input
            type="date"
            value={dataLimite}
            onChange={(e) => onChange('dataLimite', e.target.value)}
          />
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
          <Input
            type="number"
            min={1}
            value={prazo}
            onChange={(e) => onChange('prazo', Number(e.target.value))}
            placeholder="Prazo (dias)"
          />
          <div className="flex items-center gap-1">
            <Select value={tipoPrazo} onValueChange={(val) => onChange('tipoPrazo', val)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="corridos">Corridos</SelectItem>
                <SelectItem value="uteis">Úteis</SelectItem>
              </SelectContent>
            </Select>
            <HelpTooltip content="Corridos = todos os dias do calendário, incluindo fins de semana. Úteis = apenas dias úteis (exceto sábados e domingos)." />
          </div>
        </div>
      )}
      {membros.length === 0 ? (
        <EmptyStateGuide
          icon="👤"
          title="Nenhum membro cadastrado"
          description="Para atribuir responsáveis às etapas, adicione membros na página"
          actionLabel="Equipe"
          actionHref="/equipe"
          hint="💡 Membros são pessoas da equipe (designers, redatores, etc). Para dar acesso ao CRM, vincule o membro a um usuário do workspace."
        />
      ) : (
        <Select
          value={responsavelId != null ? String(responsavelId) : '__none__'}
          onValueChange={(val) =>
            onChange('responsavelId', val === '__none__' ? null : Number(val))
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Sem responsável" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Sem responsável</SelectItem>
            {[...membros]
              .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
              .map((m) => (
                <SelectItem key={m.id} value={String(m.id)}>
                  {m.nome}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      )}
      {error && (
        <p role="alert" style={{ fontSize: '0.72rem', color: 'var(--danger)', margin: 0 }}>
          {error}
        </p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        <button
          type="button"
          aria-pressed={tipo === 'aprovacao_cliente'}
          onClick={() =>
            onChange('tipo', tipo === 'aprovacao_cliente' ? 'padrao' : 'aprovacao_cliente')
          }
          style={{
            alignSelf: 'flex-start',
            fontSize: '0.72rem',
            fontWeight: tipo === 'aprovacao_cliente' ? 600 : 400,
            borderRadius: 999,
            padding: '2px 10px',
            cursor: 'pointer',
            border:
              tipo === 'aprovacao_cliente' ? '1px solid #1d4ed8' : '1px solid var(--border-color)',
            background: tipo === 'aprovacao_cliente' ? '#1d4ed8' : 'transparent',
            color: tipo === 'aprovacao_cliente' ? '#fff' : 'var(--text-muted)',
          }}
        >
          {tipo === 'aprovacao_cliente' ? '✓ Aprovação externa' : 'Aprovação externa'}
        </button>
        {tipo === 'aprovacao_cliente' && (
          <p style={{ fontSize: '0.7rem', color: '#1d4ed8', margin: 0 }}>
            Etapa especial: envia os posts para aprovação no portal do cliente (Hub).
          </p>
        )}
      </div>
    </div>
  );
}

// ---- Sortable etapa list wrapper ----
export function SortableEtapaList({
  etapas,
  setEtapas,
  modoPrazo,
  membros,
  rowErrors,
}: {
  etapas: EtapaFormData[];
  setEtapas: (e: EtapaFormData[]) => void;
  modoPrazo: ModoPrazo;
  membros: Membro[];
  rowErrors?: Map<string, string>;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIdx = etapas.findIndex((e) => e._id === active.id);
      const newIdx = etapas.findIndex((e) => e._id === over.id);
      if (oldIdx !== -1 && newIdx !== -1) setEtapas(arrayMove(etapas, oldIdx, newIdx));
    }
  };

  return (
    <div
      style={{
        borderTop: '1px solid var(--border-color)',
        paddingTop: '1rem',
        marginTop: '0.5rem',
      }}
    >
      <h4 style={{ marginBottom: '0.75rem' }}>Etapas</h4>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={etapas.map((e) => e._id)} strategy={verticalListSortingStrategy}>
          {etapas.map((e, i) => (
            <SortableEtapaRow
              key={e._id}
              id={e._id}
              index={i}
              nome={e.nome}
              prazo={e.prazo}
              tipoPrazo={e.tipoPrazo}
              responsavelId={e.responsavelId}
              tipo={e.tipo}
              dataLimite={e.dataLimite}
              modoPrazo={modoPrazo}
              membros={membros}
              error={rowErrors?.get(e._id)}
              onChange={(field, val) => {
                const next = [...etapas];
                (next[i] as unknown as Record<string, unknown>)[field] = val;
                setEtapas(next);
              }}
              onRemove={() => setEtapas(etapas.filter((_, idx) => idx !== i))}
            />
          ))}
        </SortableContext>
      </DndContext>
      <Button size="sm" variant="outline" onClick={() => setEtapas([...etapas, defaultEtapa()])}>
        <Plus className="h-3 w-3" /> Adicionar Etapa
      </Button>
    </div>
  );
}
