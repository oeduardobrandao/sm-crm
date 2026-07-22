import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PrerequisiteAlert } from '@/components/help/PrerequisiteAlert';
import type { Membro } from '../../../../store';
import { SortableEtapaList, defaultEtapa } from '../../components/SortableEtapaList';
import { SUGGESTED_ETAPAS } from '../wizardLogic';
import type { WizardState } from '../NewWorkflowWizard';

/** `SUGGESTED_ETAPAS` is `as const`, so its entries are readonly — type against that, not a mutable row. */
type Suggestion = (typeof SUGGESTED_ETAPAS)[number];

const NONE = '__none__';

export function StepEtapas({
  state,
  patch,
  membros,
  rowErrors,
  globalError,
}: {
  state: WizardState;
  patch: (p: Partial<WizardState>) => void;
  membros: Membro[];
  rowErrors?: Map<string, string>;
  globalError?: string | null;
}) {
  const active = new Set(state.etapas.map((e) => e.suggestionId).filter(Boolean));
  // Client approval is a per-row property (also toggled by each row's "Aprovação externa" pill) and
  // a fluxo may hold several approval etapas under any name, so the single approval chip reflects
  // the whole set: pressed when ANY approval etapa exists, not just a suggestionId-bound one.
  const hasApproval = state.etapas.some((e) => e.tipo === 'aprovacao_cliente');
  const chipPressed = (sug: Suggestion) =>
    sug.tipo === 'aprovacao_cliente' ? hasApproval : active.has(sug.suggestionId);

  const toggleChip = (sug: Suggestion) => {
    if (chipPressed(sug)) {
      if (sug.tipo === 'aprovacao_cliente') {
        // The chip represents client approval as a whole — turning it off clears every approval
        // etapa (row pills stay the way to add/remove a single one).
        patch({ etapas: state.etapas.filter((e) => e.tipo !== 'aprovacao_cliente') });
      } else {
        // Removal keys off suggestionId, never nome — the user may have renamed the row.
        patch({ etapas: state.etapas.filter((e) => e.suggestionId !== sug.suggestionId) });
      }
    } else {
      patch({
        etapas: [
          ...state.etapas,
          defaultEtapa({
            nome: sug.nome,
            prazo: sug.prazo,
            tipoPrazo: sug.tipoPrazo,
            tipo: sug.tipo,
            suggestionId: sug.suggestionId,
          }),
        ],
      });
    }
  };

  const bulkAssign = (id: number | null) =>
    patch({ etapas: state.etapas.map((e) => ({ ...e, responsavelId: id })) });

  // Derived, not stored: the control shows a member only while every etapa really shares it.
  const shared = state.etapas[0]?.responsavelId ?? null;
  const allShare = state.etapas.length > 0 && state.etapas.every((e) => e.responsavelId === shared);
  const bulkValue = allShare && shared != null ? String(shared) : '';

  const sortedMembros = [...membros].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <h3 style={{ margin: 0 }}>As etapas</h3>
      <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0 }}>
        Clique nas sugestões para montar o fluxo. Você pode renomear, reordenar e ajustar prazos
        abaixo.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
        {SUGGESTED_ETAPAS.map((sug) => {
          const pressed = chipPressed(sug);
          const approval = sug.tipo === 'aprovacao_cliente';
          const accent = approval ? '#1d4ed8' : '#eab308';
          return (
            <button
              key={sug.suggestionId}
              type="button"
              aria-pressed={pressed}
              onClick={() => toggleChip(sug)}
              style={{
                fontSize: '0.75rem',
                fontWeight: pressed ? 600 : 400,
                borderRadius: 999,
                padding: '4px 12px',
                cursor: 'pointer',
                border: pressed ? `1px solid ${accent}` : '1px solid var(--border-color)',
                background: pressed ? accent : 'transparent',
                color: pressed ? (approval ? '#fff' : '#12151a') : 'var(--text-muted)',
              }}
            >
              {pressed ? `✓ ${sug.nome}` : sug.nome}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => patch({ etapas: [...state.etapas, defaultEtapa()] })}
        style={{
          alignSelf: 'flex-start',
          fontSize: '0.75rem',
          borderRadius: 999,
          padding: '4px 12px',
          cursor: 'pointer',
          border: '1px dashed var(--border-color)',
          background: 'transparent',
          color: 'var(--text-muted)',
        }}
      >
        ＋ Personalizada
      </button>

      {membros.length === 0 ? (
        <PrerequisiteAlert
          title="Nenhum membro cadastrado"
          description="Para atribuir responsáveis às etapas, adicione membros na página"
          actionLabel="Equipe"
          actionHref="/equipe"
        />
      ) : (
        <div className="space-y-1">
          <Label htmlFor="wizard-bulk-responsavel">Atribuir todas a…</Label>
          {/* `!v` guards the empty placeholder value, which must never become responsavelId 0. */}
          <Select
            value={bulkValue}
            onValueChange={(v) => bulkAssign(v === NONE || !v ? null : Number(v))}
          >
            <SelectTrigger id="wizard-bulk-responsavel">
              <SelectValue placeholder="Escolha um responsável" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Sem responsável</SelectItem>
              {sortedMembros.map((m) => (
                <SelectItem key={m.id} value={String(m.id)}>
                  {m.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0 }}>
            Define o responsável de todas as etapas de uma vez. Dá para ajustar cada uma depois.
          </p>
        </div>
      )}

      <SortableEtapaList
        etapas={state.etapas}
        setEtapas={(etapas) => patch({ etapas })}
        modoPrazo={state.modoPrazo}
        membros={membros}
        rowErrors={rowErrors}
      />

      {globalError && (
        <p role="alert" style={{ fontSize: '0.75rem', color: 'var(--danger)', margin: 0 }}>
          {globalError}
        </p>
      )}
    </div>
  );
}
