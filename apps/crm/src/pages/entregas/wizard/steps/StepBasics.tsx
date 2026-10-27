import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PlatformChips, usePlatformChipsVisible } from '@/components/PlatformChips';
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
  clienteLocked = false,
}: {
  state: WizardState;
  patch: (p: Partial<WizardState>) => void;
  clientes: Cliente[];
  /** The client comes from a linha editorial and cannot change. */
  clienteLocked?: boolean;
}) {
  const { t } = useTranslation('workflows');
  const activeClientes = clientes
    .filter((c) => c.status === 'ativo')
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const showPlataformas = usePlatformChipsVisible(state.plataformas);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <h3 style={{ margin: 0 }}>{t('wizard.basicsTitle')}</h3>

      <div className="space-y-1">
        <Label htmlFor="wizard-cliente">{t('wizard.client')}</Label>
        <Select value={state.clienteId} onValueChange={(v) => patch({ clienteId: v })}>
          <SelectTrigger id="wizard-cliente" disabled={clienteLocked}>
            <SelectValue placeholder={t('wizard.selectClient')} />
          </SelectTrigger>
          <SelectContent>
            {activeClientes.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {clienteLocked && (
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0 }}>
            {t('wizard.clientFromLinha')}
          </p>
        )}
      </div>

      <div className="space-y-1">
        <Label htmlFor="wizard-nome">{t('wizard.flowName')}</Label>
        <Input
          id="wizard-nome"
          value={state.nome}
          placeholder={t('wizard.flowNamePlaceholder')}
          onChange={(e) => patch({ nome: e.target.value, nomeEdited: true })}
        />
        <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0 }}>
          {t('wizard.flowNameHint')}
        </p>
      </div>

      {showPlataformas && (
        <div className="space-y-1">
          <Label htmlFor="wizard-plataformas">{t('wizard.flowPlatforms')}</Label>
          <PlatformChips
            id="wizard-plataformas"
            value={state.plataformas}
            onChange={(plataformas) => patch({ plataformas })}
          />
        </div>
      )}

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
            {t('shared.recurringWorkflow')}
          </span>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0 }}>
            {t('wizard.recurringHint')}
          </p>
        </div>
      </div>
    </div>
  );
}
