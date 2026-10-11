import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Clock, HardDrive, Info, Trash2, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { supabase } from '../../../lib/supabase';
import {
  getStorageAutoclean,
  updateStorageAutoclean,
  type StorageAutocleanSettings,
} from '../../../store/workspace';
import { useIsWorkspaceOwner } from '../../../hooks/useIsWorkspaceOwner';
import { useWorkspaceUsage } from '../../../hooks/useWorkspaceUsage';
import { useWorkspaceLimits } from '../../../hooks/useWorkspaceLimits';
import { UsageMeter } from '../../../components/usage/UsageMeter';
import { formatStorageBytes } from '../../../components/usage/usage-meter-state';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { GroupedList, Cell } from '@/components/mobile/GroupedList';
import { PickerCell } from '@/components/mobile/PickerSheet';
import { BottomActionBar } from '@/components/mobile/BottomActionBar';
import { ConfigPhoneScreen } from '../phone/ConfigPhoneScreen';

const HINT: CSSProperties = {
  fontSize: '0.8rem',
  lineHeight: 1.5,
  color: 'var(--text-muted)',
  marginTop: '0.5rem',
  maxWidth: '52ch',
};
const FIELD: CSSProperties = { marginBottom: '1.5rem' };
const FIELD_LABEL: CSSProperties = { display: 'block', marginBottom: '0.5rem' };

// Value NaN never matches, so a custom DB value (e.g. delay 14 saved elsewhere)
// falls through to the extra option appended at render time.
const DELAY_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'Imediatamente' },
  { value: 7, label: '7 dias' },
  { value: 30, label: '30 dias' },
  { value: 90, label: '90 dias' },
];
// null = sempre executa (sem limiar).
const THRESHOLD_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: 'Sempre' },
  { value: 50, label: '50%' },
  { value: 75, label: '75%' },
  { value: 90, label: '90%' },
];

/** Same titled-card shape as HubTab's SectionCard (kept local per tab, house style). */
function SectionCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="card animate-up" style={{ marginBottom: '1rem' }}>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}
      >
        <Icon size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} aria-hidden="true" />
        <h4 style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-main)', margin: 0 }}>
          {title}
        </h4>
      </div>
      <p style={{ ...HINT, marginTop: 0, marginBottom: '1.25rem' }}>{description}</p>
      {children}
    </div>
  );
}

function SegmentedControl({
  value,
  onChange,
  options,
  ariaLabel,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      className="justify-start"
      value={value}
      // Radix fires '' when the active item is re-clicked — a segmented control
      // never goes empty, ignore it.
      onValueChange={(next) => next && onChange(next)}
      aria-label={ariaLabel}
      disabled={disabled}
    >
      {options.map((opt) => (
        <ToggleGroupItem key={opt.value} value={opt.value} aria-label={opt.label}>
          {opt.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

// 'null' is the sentinel string for "Sempre" inside the ToggleGroup (which only
// speaks strings); parse back on change.
const thresholdToStr = (v: number | null) => (v === null ? 'null' : String(v));

export default function ArmazenamentoTab() {
  const isOwner = useIsWorkspaceOwner();
  const isPhone = !useIsDesktop(768);
  const queryClient = useQueryClient();

  const {
    data: settings,
    isError: settingsFailed,
    isLoading: settingsLoading,
  } = useQuery<StorageAutocleanSettings>({
    queryKey: ['workspace-storage-autoclean'],
    queryFn: getStorageAutoclean,
    enabled: isOwner,
  });

  const { usage } = useWorkspaceUsage();
  const { limits, planName, isLoading: limitsLoading, isUnlimited } = useWorkspaceLimits();

  const [enabled, setEnabled] = useState(false);
  const [delayDays, setDelayDays] = useState(30);
  const [thresholdPct, setThresholdPct] = useState<number | null>(null);

  useEffect(() => {
    if (!settings) return;
    setEnabled(settings.storage_autoclean_enabled);
    setDelayDays(settings.storage_autoclean_delay_days);
    setThresholdPct(settings.storage_autoclean_threshold_pct);
  }, [settings]);

  // Live what-if while the user changes the delay, before saving.
  const { data: preview, isLoading: previewLoading } = useQuery({
    queryKey: ['storage-autoclean-preview', delayDays],
    queryFn: async (): Promise<{ files_count?: number; bytes_total?: number }> => {
      const { data, error } = await supabase.rpc('storage_autoclean_preview', {
        p_delay_days: delayDays,
      });
      if (error) throw error;
      return (data ?? {}) as { files_count?: number; bytes_total?: number };
    },
    enabled: isOwner,
    staleTime: 30 * 1000,
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      updateStorageAutoclean({
        storage_autoclean_enabled: enabled,
        storage_autoclean_delay_days: delayDays,
        storage_autoclean_threshold_pct: thresholdPct,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-storage-autoclean'] });
      toast.success('Configuração de armazenamento salva!');
    },
    onError: (err: unknown) => {
      console.error('storage autoclean save failed', err);
      toast.error('Não foi possível salvar. Tente novamente.');
    },
  });

  // configTabs `roles` only hides the tab from the nav; this is the real gate.
  if (!isOwner) {
    if (isPhone) {
      return (
        <ConfigPhoneScreen title="Armazenamento">
          <GroupedList aria-label="Armazenamento">
            <li className="phone-cell phone-config-block">
              Somente o dono do workspace pode ver e alterar estas configurações.
            </li>
          </GroupedList>
        </ConfigPhoneScreen>
      );
    }
    return (
      <div>
        <h3 className="config-title">Armazenamento</h3>
        <p style={HINT}>Somente o dono do workspace pode ver e alterar estas configurações.</p>
      </div>
    );
  }

  const quota = limits?.storage_quota_bytes ?? null;
  // Threshold is a percentage of the plan quota; with unlimited storage the
  // percentage is undefined and the executor fail-safes to "never run", so the
  // selector is hidden entirely. While limits load, keep it visible-but-inert.
  const storageUnlimited = !limitsLoading && (isUnlimited || (limits !== null && quota === null));

  const usedBytes = usage?.storage_used_bytes ?? 0;
  const controlsDisabled = settingsLoading || settingsFailed;

  const delayOptions = DELAY_OPTIONS.some((o) => o.value === delayDays)
    ? DELAY_OPTIONS
    : [...DELAY_OPTIONS, { value: delayDays, label: `${delayDays} dias` }].sort(
        (a, b) => a.value - b.value,
      );
  const thresholdOptions = THRESHOLD_OPTIONS.some((o) => o.value === thresholdPct)
    ? THRESHOLD_OPTIONS
    : [...THRESHOLD_OPTIONS, { value: thresholdPct, label: `${thresholdPct}%` }];

  const previewBytes = preview?.bytes_total ?? 0;
  const previewCount = preview?.files_count ?? 0;

  const lastRun = settings?.storage_autoclean_last_run_at;

  const estimate = previewLoading ? (
    'Calculando estimativa...'
  ) : (
    <>
      Com essas regras, hoje {previewCount === 1 ? 'seria liberado' : 'seriam liberados'} ~
      {formatStorageBytes(previewBytes)} ({previewCount}{' '}
      {previewCount === 1 ? 'arquivo' : 'arquivos'}).
    </>
  );
  const lastRunText = lastRun
    ? `Última limpeza: ${new Date(lastRun).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })} · ${settings?.storage_autoclean_last_files ?? 0} ${
        (settings?.storage_autoclean_last_files ?? 0) === 1 ? 'arquivo' : 'arquivos'
      } · ${formatStorageBytes(settings?.storage_autoclean_last_bytes ?? 0)} liberados`
    : 'Nunca executada';

  if (isPhone) {
    return (
      <ConfigPhoneScreen
        title="Armazenamento"
        subtitle="Acompanhe o uso do workspace e libere espaço automaticamente."
      >
        <GroupedList
          header="Uso de armazenamento"
          footer="Espaço ocupado por imagens, vídeos e documentos do workspace."
        >
          <li className="phone-cell phone-config-block">
            <UsageMeter
              label="Armazenamento"
              used={usedBytes}
              limit={limitsLoading ? usedBytes || 1 : quota}
              format={formatStorageBytes}
              showUpgradeCta={isOwner}
              subText={
                planName && quota !== null
                  ? `Seu plano ${planName} inclui ${formatStorageBytes(quota)}.`
                  : undefined
              }
            />
          </li>
        </GroupedList>

        <GroupedList
          header="Limpeza automática"
          footer="Remove as mídias de posts já publicados no Instagram e no TikTok. O post continua no histórico, com o link da publicação. Arquivos da página Arquivos, documentos e mídias de posts não publicados nunca são removidos."
        >
          <Cell
            label="Ativar limpeza automática"
            disabled={controlsDisabled}
            switch={{ checked: enabled, onCheckedChange: setEnabled }}
          />
        </GroupedList>

        <GroupedList
          aria-label="Regras da limpeza"
          footer={
            storageUnlimited
              ? 'Contado a partir da publicação do post.'
              : 'Contado a partir da publicação do post. A limpeza roda uma vez por dia, de madrugada.'
          }
        >
          <PickerCell<number>
            label="Quando remover"
            sheetTitle="Quando remover a mídia após a publicação"
            options={delayOptions.map((o) => ({ value: o.value, label: o.label }))}
            value={delayDays}
            onChange={(v) => {
              if (v !== null) setDelayDays(v);
            }}
            disabled={controlsDisabled || !enabled}
          />
          {!storageUnlimited && (
            <PickerCell<number>
              label="Somente acima de"
              sheetTitle="Somente quando o uso passar de"
              options={thresholdOptions
                .filter((o): o is { value: number; label: string } => o.value !== null)
                .map((o) => ({ value: o.value, label: o.label }))}
              emptyOption={{ label: 'Sempre' }}
              value={thresholdPct}
              onChange={setThresholdPct}
              disabled={controlsDisabled || !enabled}
            />
          )}
        </GroupedList>

        <GroupedList
          header="Estimativa"
          footer="Estimativa ao vivo. Arquivos usados em ideias ou em posts ainda não publicados ficam de fora."
        >
          <li className="phone-cell phone-config-block" aria-live="polite">
            {estimate}
          </li>
          <li className="phone-cell phone-config-block">
            <span style={{ color: 'var(--phone-label-secondary)' }}>{lastRunText}</span>
          </li>
        </GroupedList>

        {settingsFailed && (
          <p
            role="alert"
            className="phone-group__footer"
            style={{ color: 'var(--phone-destructive)' }}
          >
            Não foi possível carregar as configurações de armazenamento. Recarregue a página. Salvar
            agora sobrescreveria a sua configuração com os valores padrão.
          </p>
        )}

        <BottomActionBar aboveTabBar>
          <button
            type="button"
            className="phone-config-primary"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || controlsDisabled}
            aria-busy={saveMutation.isPending || undefined}
          >
            Salvar alterações
          </button>
        </BottomActionBar>
      </ConfigPhoneScreen>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <h3 className="config-title">Armazenamento</h3>
        <p style={{ ...HINT, marginTop: '0.25rem' }}>
          Acompanhe o uso do workspace e libere espaço automaticamente.
        </p>
      </div>

      <SectionCard
        icon={HardDrive}
        title="Uso de armazenamento"
        description="Espaço ocupado por imagens, vídeos e documentos do workspace."
      >
        <UsageMeter
          label="Armazenamento"
          used={usedBytes}
          limit={limitsLoading ? usedBytes || 1 : quota}
          format={formatStorageBytes}
          showUpgradeCta={isOwner}
          subText={
            planName && quota !== null
              ? `Seu plano ${planName} inclui ${formatStorageBytes(quota)}.`
              : undefined
          }
        />
      </SectionCard>

      <SectionCard
        icon={Trash2}
        title="Limpeza automática"
        description="Remove as mídias de posts já publicados no Instagram e no TikTok. O post continua no histórico, com o link da publicação. Arquivos da página Arquivos, documentos e mídias de posts não publicados nunca são removidos."
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            marginBottom: '1.25rem',
          }}
        >
          <Label htmlFor="storage-autoclean-enabled" style={{ fontWeight: 500, cursor: 'pointer' }}>
            Ativar limpeza automática
          </Label>
          <Switch
            id="storage-autoclean-enabled"
            checked={enabled}
            disabled={controlsDisabled}
            onCheckedChange={setEnabled}
          />
        </div>

        <div style={FIELD}>
          <Label style={FIELD_LABEL}>Quando remover</Label>
          <SegmentedControl
            value={String(delayDays)}
            onChange={(v) => setDelayDays(Number(v))}
            options={delayOptions.map((o) => ({ value: String(o.value), label: o.label }))}
            ariaLabel="Quando remover a mídia após a publicação"
            disabled={controlsDisabled || !enabled}
          />
          <p style={{ ...HINT, marginTop: '0.4rem' }}>Contado a partir da publicação do post.</p>
        </div>

        {!storageUnlimited && (
          <div style={FIELD}>
            <Label style={FIELD_LABEL}>Somente quando o uso passar de</Label>
            <SegmentedControl
              value={thresholdToStr(thresholdPct)}
              onChange={(v) => setThresholdPct(v === 'null' ? null : Number(v))}
              options={thresholdOptions.map((o) => ({
                value: thresholdToStr(o.value),
                label: o.label,
              }))}
              ariaLabel="Limiar de uso para executar a limpeza"
              disabled={controlsDisabled || !enabled}
            />
            <p style={{ ...HINT, marginTop: '0.4rem' }}>
              A limpeza roda uma vez por dia, de madrugada.
            </p>
          </div>
        )}

        <div
          style={{
            display: 'flex',
            gap: '0.6rem',
            alignItems: 'flex-start',
            background: 'color-mix(in srgb, var(--warning) 10%, var(--card-bg))',
            border: '1px solid color-mix(in srgb, var(--warning) 35%, var(--card-bg))',
            borderRadius: 10,
            padding: '0.75rem 0.9rem',
            marginBottom: '1rem',
          }}
        >
          <Info
            size={15}
            style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 2 }}
            aria-hidden="true"
          />
          <div>
            <p style={{ fontSize: '0.82rem', margin: 0, color: 'var(--text-main)' }}>
              {previewLoading ? (
                'Calculando estimativa...'
              ) : (
                <>
                  Com essas regras, hoje{' '}
                  {previewCount === 1 ? 'seria liberado' : 'seriam liberados'}{' '}
                  <strong>~{formatStorageBytes(previewBytes)}</strong> ({previewCount}{' '}
                  {previewCount === 1 ? 'arquivo' : 'arquivos'}).
                </>
              )}
            </p>
            <p style={{ ...HINT, marginTop: '0.25rem', marginBottom: 0, fontSize: '0.72rem' }}>
              Estimativa ao vivo. Arquivos usados em ideias ou em posts ainda não publicados ficam
              de fora.
            </p>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            borderTop: '1px solid var(--border-color)',
            paddingTop: '0.75rem',
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
          }}
        >
          <Clock size={13} aria-hidden="true" />
          {lastRun ? (
            <span>
              Última limpeza:{' '}
              {new Date(lastRun).toLocaleString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}{' '}
              · {settings?.storage_autoclean_last_files ?? 0}{' '}
              {(settings?.storage_autoclean_last_files ?? 0) === 1 ? 'arquivo' : 'arquivos'} ·{' '}
              {formatStorageBytes(settings?.storage_autoclean_last_bytes ?? 0)} liberados
            </span>
          ) : (
            <span>Nunca executada</span>
          )}
        </div>
      </SectionCard>

      {settingsFailed && (
        <p role="alert" style={{ ...HINT, color: 'var(--danger-text)', marginBottom: 0 }}>
          Não foi possível carregar as configurações de armazenamento. Recarregue a página. Salvar
          agora sobrescreveria a sua configuração com os valores padrão.
        </p>
      )}

      <Button
        onClick={() => saveMutation.mutate()}
        disabled={saveMutation.isPending || controlsDisabled}
        style={{ marginTop: settingsFailed ? '0.75rem' : '0.25rem' }}
      >
        {saveMutation.isPending && <Spinner size="sm" />} Salvar alterações
      </Button>
    </div>
  );
}
