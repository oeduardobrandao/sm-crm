import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, GripVertical, UserCheck } from 'lucide-react';
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

export type ModoPrazo = 'padrao' | 'data_fixa' | 'data_entrega';

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

export interface EtapaHighlight {
  id: string;
  token: number;
}

// Tokens are globally unique so highlight requests coming from different owners (the wizard's
// chips/Personalizada vs the list's own "Adicionar Etapa") stay ordered against each other.
let _highlightTokenCounter = 0;
export function nextHighlightToken(): number {
  return ++_highlightTokenCounter;
}

/** The row a repeated "add custom etapa" click should re-focus instead of appending another. */
export function findEmptyEtapa(etapas: EtapaFormData[]): EtapaFormData | undefined {
  return etapas.find((e) => !e.suggestionId && e.nome.trim() === '');
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
  highlighted: boolean;
  highlightToken: number;
  onChange: (field: string, val: unknown) => void;
  onRemove: () => void;
}) {
  const {
    id,
    index,
    nome,
    prazo,
    tipoPrazo,
    responsavelId,
    tipo,
    dataLimite,
    modoPrazo,
    membros,
    error,
    highlighted,
    highlightToken,
    onChange,
    onRemove,
  } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const rowRef = useRef<HTMLDivElement | null>(null);
  const nomeInputRef = useRef<HTMLInputElement | null>(null);
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  useEffect(() => {
    if (!highlighted) return;
    const el = rowRef.current;
    if (!el) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' });
    // Remove + reflow + re-add so a second highlight of the same row restarts the flash.
    el.classList.remove('etapa-row-flash');
    void el.offsetWidth;
    el.classList.add('etapa-row-flash');
    if (nomeInputRef.current && nomeInputRef.current.value.trim() === '') {
      nomeInputRef.current.focus({ preventScroll: true });
    }
  }, [highlighted, highlightToken]);

  const approval = tipo === 'aprovacao_cliente';

  return (
    <div
      ref={(el) => {
        setNodeRef(el);
        rowRef.current = el;
      }}
      className="flex flex-wrap items-center gap-1.5"
      style={{
        ...style,
        marginBottom: '0.4rem',
        padding: '0.4rem 0.6rem',
        border: approval ? '1px solid #bfdbfe' : '1px solid var(--border-color)',
        background: approval ? 'rgba(59,130,246,0.06)' : undefined,
        borderRadius: '8px',
      }}
      {...attributes}
    >
      <div className="flex min-w-0 flex-1 basis-52 items-center gap-1.5">
        <span
          className="w-5 shrink-0 text-right text-xs tabular-nums"
          style={{ color: 'var(--text-muted)' }}
        >
          {index + 1}.
        </span>
        <div
          {...listeners}
          className="shrink-0"
          style={{ cursor: 'grab', color: 'var(--text-muted)' }}
        >
          <GripVertical className="h-4 w-4" />
        </div>
        <Input
          ref={nomeInputRef}
          placeholder="Nome da etapa"
          value={nome}
          onChange={(e) => onChange('nome', e.target.value)}
          className="h-8 min-w-0 flex-1 text-sm"
        />
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {modoPrazo === 'data_fixa' ? (
          <Input
            type="date"
            aria-label="Data limite"
            value={dataLimite}
            onChange={(e) => onChange('dataLimite', e.target.value)}
            className="h-8 w-36 text-sm"
          />
        ) : (
          <>
            <Input
              type="number"
              min={1}
              aria-label="Prazo em dias"
              value={prazo}
              onChange={(e) => onChange('prazo', Number(e.target.value))}
              className="h-8 w-14 text-center text-sm"
            />
            <Select value={tipoPrazo} onValueChange={(val) => onChange('tipoPrazo', val)}>
              <SelectTrigger
                aria-label="Tipo de prazo"
                title="Dias corridos ou úteis"
                className="h-8 w-24 text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="corridos">Corridos</SelectItem>
                <SelectItem value="uteis">Úteis</SelectItem>
              </SelectContent>
            </Select>
          </>
        )}
        {membros.length > 0 && (
          <Select
            value={responsavelId != null ? String(responsavelId) : '__none__'}
            onValueChange={(val) =>
              onChange('responsavelId', val === '__none__' ? null : Number(val))
            }
          >
            <SelectTrigger aria-label="Responsável" className="h-8 w-40 text-xs">
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
        <button
          type="button"
          aria-pressed={approval}
          aria-label="Aprovação externa"
          title={
            approval
              ? 'Aprovação externa ativa: o cliente aprova esta etapa no Hub'
              : 'Marcar como aprovação externa: o cliente aprova esta etapa no Hub'
          }
          onClick={() => onChange('tipo', approval ? 'padrao' : 'aprovacao_cliente')}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
          style={{
            cursor: 'pointer',
            border: approval ? '1px solid #1d4ed8' : '1px solid var(--border-color)',
            background: approval ? '#1d4ed8' : 'transparent',
            color: approval ? '#fff' : 'var(--text-muted)',
          }}
        >
          <UserCheck className="h-4 w-4" />
        </button>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Remover etapa"
          className="h-8 w-8 shrink-0 text-destructive"
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      {membros.length === 0 && (
        <div className="w-full">
          <EmptyStateGuide
            icon="👤"
            title="Nenhum membro cadastrado"
            description="Para atribuir responsáveis às etapas, adicione membros na página"
            actionLabel="Equipe"
            actionHref="/equipe"
            hint="💡 Membros são pessoas da equipe (designers, redatores, etc). Para dar acesso ao CRM, vincule o membro a um usuário do workspace."
          />
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="w-full"
          style={{ fontSize: '0.72rem', color: 'var(--danger-text)', margin: 0 }}
        >
          {error}
        </p>
      )}
      {approval && (
        <p className="w-full" style={{ fontSize: '0.7rem', color: '#1d4ed8', margin: 0 }}>
          Etapa especial: envia os posts para aprovação no portal do cliente (Hub).
        </p>
      )}
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
  highlight,
}: {
  etapas: EtapaFormData[];
  setEtapas: (e: EtapaFormData[]) => void;
  modoPrazo: ModoPrazo;
  membros: Membro[];
  rowErrors?: Map<string, string>;
  highlight?: EtapaHighlight | null;
}) {
  // The parent (wizard chips/Personalizada) and the list's own "Adicionar Etapa" button both
  // request highlights; the freshest token wins.
  const [internalHighlight, setInternalHighlight] = useState<EtapaHighlight | null>(null);
  const effectiveHighlight =
    highlight && internalHighlight
      ? highlight.token > internalHighlight.token
        ? highlight
        : internalHighlight
      : (highlight ?? internalHighlight);

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

  const handleAdd = () => {
    const empty = findEmptyEtapa(etapas);
    if (empty) {
      setInternalHighlight({ id: empty._id, token: nextHighlightToken() });
      return;
    }
    const nova = defaultEtapa();
    setEtapas([...etapas, nova]);
    setInternalHighlight({ id: nova._id, token: nextHighlightToken() });
  };

  return (
    <div
      style={{
        borderTop: '1px solid var(--border-color)',
        paddingTop: '1rem',
        marginTop: '0.5rem',
      }}
    >
      <div className="mb-2 flex items-center gap-1.5">
        <h4 style={{ margin: 0 }}>{etapas.length > 0 ? `Etapas · ${etapas.length}` : 'Etapas'}</h4>
        {modoPrazo !== 'data_fixa' && (
          <HelpTooltip content="Corridos = todos os dias do calendário, incluindo fins de semana. Úteis = apenas dias úteis (exceto sábados e domingos)." />
        )}
      </div>
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
              highlighted={effectiveHighlight?.id === e._id}
              highlightToken={effectiveHighlight?.token ?? 0}
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
      <Button size="sm" variant="outline" onClick={handleAdd}>
        <Plus className="h-3 w-3" /> Adicionar Etapa
      </Button>
    </div>
  );
}
