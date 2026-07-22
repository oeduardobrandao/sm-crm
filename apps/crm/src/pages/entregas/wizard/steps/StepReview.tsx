import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Cliente } from '../../../../store';
import { countApprovals } from '../wizardLogic';
import { resolveDeliveryDate } from '../createWorkflow';
import type { WizardState } from '../NewWorkflowWizard';

type ModoPrazo = WizardState['modoPrazo'];

const MODO_LABEL: Record<ModoPrazo, string> = {
  padrao: 'Duração por etapa',
  data_fixa: 'Datas fixas',
  data_entrega: 'Data de entrega do cliente',
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: '1rem',
        padding: '0.5rem 0',
        borderBottom: '1px solid var(--border-color)',
      }}
    >
      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontSize: '0.8rem', fontWeight: 600, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

export function StepReview({
  state,
  patch,
  modoPrazo,
  cliente,
}: {
  state: WizardState;
  patch: (p: Partial<WizardState>) => void;
  /** The EFFECTIVE mode — the shell falls back to `padrao` when data_entrega is unavailable. */
  modoPrazo: ModoPrazo;
  cliente: Cliente | undefined;
}) {
  // Blank rows are dropped at creation, so the summary counts only what will actually be saved.
  const etapas = state.etapas.filter((e) => e.nome.trim());
  const aprovacoes = countApprovals(etapas);

  let prazosValor = MODO_LABEL[modoPrazo];
  if (modoPrazo === 'data_entrega' && cliente?.dia_entrega) {
    const entrega = resolveDeliveryDate(state.mesEntrega, cliente.dia_entrega);
    prazosValor += ` · entrega em ${entrega.toLocaleDateString('pt-BR')}`;
  }

  const defaultTemplateName =
    state.source?.kind === 'preset'
      ? `${state.source.presetNome} — ${cliente?.nome ?? ''}`.trim()
      : state.source?.kind === 'template'
        ? state.source.templateNome
        : state.nome;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <h3 style={{ margin: 0 }}>Revisar e criar</h3>

      <div>
        <Row label="Cliente" value={cliente?.nome ?? '—'} />
        <Row label="Nome" value={state.nome} />
        {/* The row's label already says "Etapas", so the value is just the count. */}
        <Row
          label="Etapas"
          value={
            aprovacoes > 0
              ? `${etapas.length} (${aprovacoes} ${
                  aprovacoes === 1 ? 'aprovação do cliente' : 'aprovações do cliente'
                })`
              : String(etapas.length)
          }
        />
        <Row label="Prazos" value={prazosValor} />
        <Row label="Recorrente" value={state.recorrente ? 'Sim' : 'Não'} />
      </div>

      <label
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'flex-start',
          background: 'rgba(234,179,8,0.08)',
          border: '1px solid rgba(234,179,8,0.35)',
          borderRadius: 10,
          padding: '0.7rem 0.9rem',
        }}
      >
        <input
          type="checkbox"
          checked={state.saveAsTemplate}
          onChange={(e) =>
            patch({
              saveAsTemplate: e.target.checked,
              templateName: state.templateName || defaultTemplateName,
            })
          }
        />
        <span>
          <b>Salvar estas etapas como template</b>
          <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            A receita fica disponível no passo 1 para os próximos fluxos.
          </span>
        </span>
      </label>

      {state.saveAsTemplate && (
        <div className="space-y-1">
          <Label htmlFor="wizard-template-nome">Nome do template</Label>
          <Input
            id="wizard-template-nome"
            value={state.templateName}
            onChange={(e) => patch({ templateName: e.target.value })}
          />
          {/* A blank name makes the creation path skip the template silently, so say so rather
              than dropping the request without a word. */}
          {!state.templateName.trim() && (
            <p role="alert" style={{ fontSize: '0.7rem', color: 'var(--danger)', margin: 0 }}>
              Dê um nome ao template — sem nome, o fluxo é criado mas o template não é salvo.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
