import { Link } from 'react-router-dom';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Cliente, Membro } from '../../../../store';
import { SortableEtapaList } from '../../components/SortableEtapaList';
import { countApprovals, dataEntregaAvailability } from '../wizardLogic';
import type { WizardState } from '../NewWorkflowWizard';

type ModoPrazo = WizardState['modoPrazo'];

const AUTO = '__auto__';

/**
 * Six months starting at the CURRENT one. Built from day 1 of each month rather than the legacy
 * modal's `setMonth(getMonth() + i)`, which skips a month whenever "today" is a 29th–31st that the
 * target month does not have.
 */
function mesesDeEntrega(today: Date = new Date()): { value: string; label: string }[] {
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const label = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    return {
      value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: label.charAt(0).toUpperCase() + label.slice(1),
    };
  });
}

export function StepPrazos({
  state,
  patch,
  modoPrazo,
  cliente,
  membros,
  rowErrors,
  error,
}: {
  state: WizardState;
  patch: (p: Partial<WizardState>) => void;
  /** The EFFECTIVE mode — the shell falls back to `padrao` when data_entrega is unavailable. */
  modoPrazo: ModoPrazo;
  cliente: Cliente | undefined;
  membros: Membro[];
  rowErrors?: Map<string, string>;
  error?: string | null;
}) {
  const availability = dataEntregaAvailability(state.etapas, cliente);
  // `countApprovals` counts unnamed rows too, so a blank row whose "Aprovação externa" pill was
  // flipped before it was named would otherwise make a one-approval fluxo look ambiguous. Only
  // named rows reach the database, so only named rows can be the anchor.
  const aprovacoes = countApprovals(state.etapas.filter((e) => e.nome.trim()));
  // `modoPrazo` only ever differs from the stored value via the shell's auto-fallback.
  const ajustado = modoPrazo !== state.modoPrazo;
  const semDiaEntrega = !cliente?.dia_entrega;

  const opcoes: { value: ModoPrazo; titulo: string; descricao: string }[] = [
    {
      value: 'padrao',
      titulo: 'Duração por etapa',
      descricao: 'Cada etapa tem um prazo em dias, contado a partir do momento em que ela começa.',
    },
    {
      value: 'data_fixa',
      titulo: 'Datas fixas',
      descricao: 'Você define uma data limite manual para cada etapa.',
    },
    {
      value: 'data_entrega',
      titulo: 'Data de entrega do cliente',
      descricao: `Prazos calculados de trás pra frente a partir do dia de entrega do cliente${
        cliente?.dia_entrega ? ` (dia ${cliente.dia_entrega})` : ''
      }, usando a etapa de aprovação como âncora.`,
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <h3 style={{ margin: 0 }}>Os prazos</h3>
      <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0 }}>
        Como o Mesaas deve calcular o prazo de cada etapa deste fluxo.
      </p>

      {ajustado && (
        <p style={{ fontSize: '0.75rem', color: 'var(--warning)', margin: 0 }}>
          {semDiaEntrega
            ? 'Modo ajustado para Duração por etapa — o cliente não tem dia de entrega configurado.'
            : `Modo ajustado para Duração por etapa — ${availability.reason}`}
        </p>
      )}

      <div
        role="radiogroup"
        aria-label="Modo de prazo"
        style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
      >
        {opcoes.map((o) => {
          const isDataEntrega = o.value === 'data_entrega';
          const disabled = isDataEntrega && !availability.enabled;
          const selected = modoPrazo === o.value;
          return (
            <div key={o.value}>
              <label
                style={{
                  display: 'flex',
                  gap: '0.6rem',
                  alignItems: 'flex-start',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  opacity: disabled ? 0.55 : 1,
                  border: `1px solid ${selected ? '#eab308' : 'var(--border-color)'}`,
                  background: selected ? 'rgba(234,179,8,0.08)' : 'transparent',
                  borderRadius: 10,
                  padding: '0.7rem 0.9rem',
                }}
              >
                <input
                  type="radio"
                  name="wizard-modo-prazo"
                  value={o.value}
                  checked={selected}
                  disabled={disabled}
                  onChange={() => patch({ modoPrazo: o.value, modoEdited: true })}
                  style={{ marginTop: 3, flexShrink: 0 }}
                />
                <span>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                    {o.titulo}
                    {isDataEntrega && availability.enabled && aprovacoes >= 1 && (
                      <span
                        style={{
                          marginLeft: '0.4rem',
                          fontSize: '0.62rem',
                          fontWeight: 700,
                          letterSpacing: '0.04em',
                          textTransform: 'uppercase',
                          borderRadius: 999,
                          padding: '2px 8px',
                          background: '#eab308',
                          color: '#12151a',
                        }}
                      >
                        Recomendado
                      </span>
                    )}
                  </span>
                  <span
                    style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)' }}
                  >
                    {o.descricao}
                  </span>
                </span>
              </label>
              {disabled && (
                <p
                  style={{
                    fontSize: '0.7rem',
                    color: 'var(--text-muted)',
                    margin: '0.25rem 0 0 0.9rem',
                  }}
                >
                  {availability.reason}
                  {semDiaEntrega && cliente && (
                    <>
                      {' '}
                      <Link to={`/clientes/${cliente.id}`} style={{ textDecoration: 'underline' }}>
                        Configurar dia de entrega
                      </Link>
                    </>
                  )}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {modoPrazo === 'data_entrega' && (
        <>
          {aprovacoes >= 2 && (
            <p style={{ color: 'var(--warning)', fontSize: '0.75rem' }}>
              ⚠ Este fluxo tem {aprovacoes} etapas de aprovação — a primeira será a âncora da data
              de entrega.
            </p>
          )}
          <div className="space-y-1">
            <Label htmlFor="wizard-mes-entrega">Mês de Entrega</Label>
            {/* Wizard state stores '' for "próximo mês disponível"; '__auto__' is a Select-only
                sentinel because Radix treats '' as "no value selected". */}
            <Select
              value={state.mesEntrega || AUTO}
              onValueChange={(val) => patch({ mesEntrega: val === AUTO ? '' : val })}
            >
              <SelectTrigger id="wizard-mes-entrega">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTO}>Próximo mês disponível</SelectItem>
                {mesesDeEntrega().map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      {modoPrazo === 'data_fixa' && (
        <SortableEtapaList
          etapas={state.etapas}
          setEtapas={(etapas) => patch({ etapas })}
          modoPrazo="data_fixa"
          membros={membros}
          rowErrors={rowErrors}
        />
      )}

      {error && (
        <p role="alert" style={{ fontSize: '0.75rem', color: 'var(--danger)', margin: 0 }}>
          {error}
        </p>
      )}
    </div>
  );
}
