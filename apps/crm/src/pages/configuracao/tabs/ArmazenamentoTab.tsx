import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useIntlLocale } from '@mesaas/i18n';
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
const delayOptionsFor = (t: TFunction): { value: number; label: string }[] => [
  { value: 0, label: t('storage.immediately') },
  { value: 7, label: t('storage.days', { count: 7 }) },
  { value: 30, label: t('storage.days', { count: 30 }) },
  { value: 90, label: t('storage.days', { count: 90 }) },
];
// null = sempre executa (sem limiar).
const thresholdOptionsFor = (t: TFunction): { value: number | null; label: string }[] => [
  { value: null, label: t('storage.always') },
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
  const { t } = useTranslation('settingsHub');
  const intlLocale = useIntlLocale();
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
      toast.success(t('storage.toast.saved'));
    },
    onError: (err: unknown) => {
      console.error('storage autoclean save failed', err);
      toast.error(t('storage.toast.saveError'));
    },
  });

  // configTabs `roles` only hides the tab from the nav; this is the real gate.
  if (!isOwner) {
    if (isPhone) {
      return (
        <ConfigPhoneScreen title={t('storage.title')}>
          <GroupedList aria-label={t('storage.title')}>
            <li className="phone-cell phone-config-block">{t('storage.ownerOnly')}</li>
          </GroupedList>
        </ConfigPhoneScreen>
      );
    }
    return (
      <div>
        <h3 className="config-title">{t('storage.title')}</h3>
        <p style={HINT}>{t('storage.ownerOnly')}</p>
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

  const baseDelayOptions = delayOptionsFor(t);
  const delayOptions = baseDelayOptions.some((o) => o.value === delayDays)
    ? baseDelayOptions
    : [
        ...baseDelayOptions,
        { value: delayDays, label: t('storage.days', { count: delayDays }) },
      ].sort((a, b) => a.value - b.value);
  const baseThresholdOptions = thresholdOptionsFor(t);
  const thresholdOptions = baseThresholdOptions.some((o) => o.value === thresholdPct)
    ? baseThresholdOptions
    : [...baseThresholdOptions, { value: thresholdPct, label: `${thresholdPct}%` }];

  const previewBytes = preview?.bytes_total ?? 0;
  const previewCount = preview?.files_count ?? 0;

  const lastRun = settings?.storage_autoclean_last_run_at;

  const estimate = previewLoading
    ? t('storage.estimating')
    : t('storage.estimate', { count: previewCount, bytes: formatStorageBytes(previewBytes) });
  const lastRunText = lastRun
    ? t('storage.lastRun', {
        date: new Date(lastRun).toLocaleString(intlLocale, {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
        count: settings?.storage_autoclean_last_files ?? 0,
        bytes: formatStorageBytes(settings?.storage_autoclean_last_bytes ?? 0),
      })
    : t('storage.neverRun');

  if (isPhone) {
    return (
      <ConfigPhoneScreen title={t('storage.title')} subtitle={t('storage.subtitle')}>
        <GroupedList header={t('storage.usageTitle')} footer={t('storage.usageDescription')}>
          <li className="phone-cell phone-config-block">
            <UsageMeter
              label={t('storage.title')}
              used={usedBytes}
              limit={limitsLoading ? usedBytes || 1 : quota}
              format={formatStorageBytes}
              showUpgradeCta={isOwner}
              subText={
                planName && quota !== null
                  ? t('storage.planIncludes', { plan: planName, quota: formatStorageBytes(quota) })
                  : undefined
              }
            />
          </li>
        </GroupedList>

        <GroupedList
          header={t('storage.autocleanTitle')}
          footer={t('storage.autocleanDescription')}
        >
          <Cell
            label={t('storage.enableAutoclean')}
            disabled={controlsDisabled}
            switch={{ checked: enabled, onCheckedChange: setEnabled }}
          />
        </GroupedList>

        <GroupedList
          aria-label={t('storage.rulesAria')}
          footer={storageUnlimited ? t('storage.countedFrom') : t('storage.countedFromAndSchedule')}
        >
          <PickerCell<number>
            label={t('storage.whenRemove')}
            sheetTitle={t('storage.whenRemoveLong')}
            options={delayOptions.map((o) => ({ value: o.value, label: o.label }))}
            value={delayDays}
            onChange={(v) => {
              if (v !== null) setDelayDays(v);
            }}
            disabled={controlsDisabled || !enabled}
          />
          {!storageUnlimited && (
            <PickerCell<number>
              label={t('storage.onlyAbove')}
              sheetTitle={t('storage.onlyWhenAbove')}
              options={thresholdOptions
                .filter((o): o is { value: number; label: string } => o.value !== null)
                .map((o) => ({ value: o.value, label: o.label }))}
              emptyOption={{ label: t('storage.always') }}
              value={thresholdPct}
              onChange={setThresholdPct}
              disabled={controlsDisabled || !enabled}
            />
          )}
        </GroupedList>

        <GroupedList header={t('storage.estimateTitle')} footer={t('storage.estimateNote')}>
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
            {t('storage.loadError')}
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
            {t('shared.saveChanges')}
          </button>
        </BottomActionBar>
      </ConfigPhoneScreen>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <h3 className="config-title">{t('storage.title')}</h3>
        <p style={{ ...HINT, marginTop: '0.25rem' }}>{t('storage.subtitle')}</p>
      </div>

      <SectionCard
        icon={HardDrive}
        title={t('storage.usageTitle')}
        description={t('storage.usageDescription')}
      >
        <UsageMeter
          label={t('storage.title')}
          used={usedBytes}
          limit={limitsLoading ? usedBytes || 1 : quota}
          format={formatStorageBytes}
          showUpgradeCta={isOwner}
          subText={
            planName && quota !== null
              ? t('storage.planIncludes', { plan: planName, quota: formatStorageBytes(quota) })
              : undefined
          }
        />
      </SectionCard>

      <SectionCard
        icon={Trash2}
        title={t('storage.autocleanTitle')}
        description={t('storage.autocleanDescription')}
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
            {t('storage.enableAutoclean')}
          </Label>
          <Switch
            id="storage-autoclean-enabled"
            checked={enabled}
            disabled={controlsDisabled}
            onCheckedChange={setEnabled}
          />
        </div>

        <div style={FIELD}>
          <Label style={FIELD_LABEL}>{t('storage.whenRemove')}</Label>
          <SegmentedControl
            value={String(delayDays)}
            onChange={(v) => setDelayDays(Number(v))}
            options={delayOptions.map((o) => ({ value: String(o.value), label: o.label }))}
            ariaLabel={t('storage.whenRemoveLong')}
            disabled={controlsDisabled || !enabled}
          />
          <p style={{ ...HINT, marginTop: '0.4rem' }}>{t('storage.countedFrom')}</p>
        </div>

        {!storageUnlimited && (
          <div style={FIELD}>
            <Label style={FIELD_LABEL}>{t('storage.onlyWhenAbove')}</Label>
            <SegmentedControl
              value={thresholdToStr(thresholdPct)}
              onChange={(v) => setThresholdPct(v === 'null' ? null : Number(v))}
              options={thresholdOptions.map((o) => ({
                value: thresholdToStr(o.value),
                label: o.label,
              }))}
              ariaLabel={t('storage.thresholdAria')}
              disabled={controlsDisabled || !enabled}
            />
            <p style={{ ...HINT, marginTop: '0.4rem' }}>{t('storage.schedule')}</p>
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
                t('storage.estimating')
              ) : (
                <Trans
                  t={t}
                  i18nKey="storage.estimateRich"
                  count={previewCount}
                  values={{ bytes: formatStorageBytes(previewBytes) }}
                  components={{ b: <strong /> }}
                />
              )}
            </p>
            <p style={{ ...HINT, marginTop: '0.25rem', marginBottom: 0, fontSize: '0.72rem' }}>
              {t('storage.estimateNote')}
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
          {lastRun ? <span>{lastRunText}</span> : <span>{t('storage.neverRun')}</span>}
        </div>
      </SectionCard>

      {settingsFailed && (
        <p role="alert" style={{ ...HINT, color: 'var(--danger-text)', marginBottom: 0 }}>
          {t('storage.loadError')}
        </p>
      )}

      <Button
        onClick={() => saveMutation.mutate()}
        disabled={saveMutation.isPending || controlsDisabled}
        style={{ marginTop: settingsFailed ? '0.75rem' : '0.25rem' }}
      >
        {saveMutation.isPending && <Spinner size="sm" />} {t('shared.saveChanges')}
      </Button>
    </div>
  );
}
