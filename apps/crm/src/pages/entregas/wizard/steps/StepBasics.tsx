import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Cliente } from '../../../../store';
import type { WizardState } from '../NewWorkflowWizard';

export function StepBasics({
  state,
  patch,
  clientes,
}: {
  state: WizardState;
  patch: (p: Partial<WizardState>) => void;
  clientes: Cliente[];
}) {
  const activeClientes = clientes
    .filter((c) => c.status === 'ativo')
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <h3 style={{ margin: 0 }}>O básico</h3>

      <div className="space-y-1">
        <Label htmlFor="wizard-cliente">Cliente</Label>
        <Select value={state.clienteId} onValueChange={(v) => patch({ clienteId: v })}>
          <SelectTrigger id="wizard-cliente">
            <SelectValue placeholder="Selecione o cliente" />
          </SelectTrigger>
          <SelectContent>
            {activeClientes.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="wizard-nome">Nome do fluxo</Label>
        <Input
          id="wizard-nome"
          value={state.nome}
          placeholder="Ex: Posts Instagram — Março 2026"
          onChange={(e) => patch({ nome: e.target.value, nomeEdited: true })}
        />
        <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0 }}>
          Sugerido a partir do modelo e do próximo mês. Pode editar.
        </p>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
        <button
          type="button"
          role="switch"
          aria-checked={state.recorrente}
          aria-labelledby="wizard-recorrente-label"
          onClick={() => patch({ recorrente: !state.recorrente })}
          style={{
            flexShrink: 0,
            width: 38,
            height: 22,
            borderRadius: 999,
            padding: 2,
            cursor: 'pointer',
            border: '1px solid var(--border-color)',
            background: state.recorrente ? '#eab308' : 'var(--surface-2, #f1f5f9)',
            display: 'flex',
            justifyContent: state.recorrente ? 'flex-end' : 'flex-start',
          }}
        >
          <span
            style={{
              width: 16,
              height: 16,
              borderRadius: 999,
              background: '#fff',
              display: 'block',
            }}
          />
        </button>
        <div>
          <span id="wizard-recorrente-label" style={{ fontSize: '0.85rem', fontWeight: 600 }}>
            Fluxo recorrente
          </span>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0 }}>
            Ao concluir todas as etapas, o Mesaas oferece criar o próximo ciclo automaticamente.
          </p>
        </div>
      </div>
    </div>
  );
}
