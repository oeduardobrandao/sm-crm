import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { WorkflowPost } from '../../../store';

export type Platform = NonNullable<WorkflowPost['platform']>;

interface PlatformSelectorProps {
  value: Platform;
  tipo: WorkflowPost['tipo'];
  /** `feature_tiktok` from useWorkspaceLimits(). Ships dark — while false the whole
   * selector is hidden (not merely disabled), matching the rest of the TikTok surface. */
  tiktokFeatureEnabled: boolean;
  hasActiveTikTokAccount: boolean;
  /** Schedule lock (post.status === 'agendado'): the publish cron may already have built
   * the Instagram container, so retargeting the platform would desync it. Disables the
   * whole group and suspends the stories self-heal (no writes to a locked post). */
  disabled?: boolean;
  /** Writes through the same optimistic-update path `tipo` already uses
   * (WorkflowDrawer's onFieldChange -> updateWorkflowPost) — no dedicated save button. */
  onChange: (platform: Platform) => void;
}

/**
 * Segmented control (Instagram / TikTok / Ambas) for a post's target platform(s).
 * TikTok has no Stories API, so `tipo === 'stories'` always disables the TikTok-
 * targeting options; a client with no active TikTok account disables them too.
 *
 * Self-healing: whenever the post is a stories post but its persisted platform is
 * still 'tiktok'/'both' — whether that combination arrived via a live tipo change in
 * this drawer, stale data, or an out-of-band write (MCP tool, direct DB edit) — this
 * reverts it to 'instagram' and explains why, so the control never has to render a
 * disabled option as "selected".
 */
export function PlatformSelector({
  value,
  tipo,
  tiktokFeatureEnabled,
  hasActiveTikTokAccount,
  disabled = false,
  onChange,
}: PlatformSelectorProps) {
  const isStories = tipo === 'stories';

  // Guards against re-firing on every render while the parent's async write is still
  // in flight (value prop hasn't caught up to 'instagram' yet) — the effect's deps
  // already skip re-runs when [isStories, value] are unchanged, but StrictMode/dev
  // double-invoke and slow round-trips make an explicit guard worth the extra safety.
  const revertingRef = useRef(false);
  useEffect(() => {
    // While schedule-locked, the self-heal must not write either — it re-runs (and
    // heals if still needed) once the lock lifts, via `disabled` in the deps.
    if (isStories && value !== 'instagram' && !disabled) {
      if (!revertingRef.current) {
        revertingRef.current = true;
        onChange('instagram');
        toast.info('Plataforma revertida para Instagram: Stories não são suportados no TikTok.');
      }
    } else {
      revertingRef.current = false;
    }
    // onChange is expected to be referentially stable enough per post (WorkflowDrawer
    // passes an inline closure, but re-running only on isStories/value change is the
    // whole point of this guard — including onChange would defeat it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStories, value, disabled]);

  if (!tiktokFeatureEnabled) return null;

  const disabledReason = isStories
    ? 'Stories não são suportados no TikTok'
    : !hasActiveTikTokAccount
      ? 'Cliente sem conta TikTok ativa'
      : null;
  const tiktokDisabled = disabledReason !== null;

  const handleValueChange = (next: string) => {
    if (disabled) return;
    if (!next || next === value) return;
    if ((next === 'tiktok' || next === 'both') && tiktokDisabled) return;
    onChange(next as Platform);
  };

  return (
    <div
      className="drawer-post-field drawer-post-field--platform"
      title={disabled ? 'Cancelar agendamento para editar' : undefined}
    >
      <label>Plataforma</label>
      {/* Radix propagates root `disabled` to every item, so the schedule lock greys the
          whole group without touching the per-item TikTok gating below. */}
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={handleValueChange}
        className="justify-start"
        disabled={disabled}
      >
        <ToggleGroupItem value="instagram" aria-label="Instagram">
          Instagram
        </ToggleGroupItem>
        <span title={tiktokDisabled ? (disabledReason as string) : undefined}>
          <ToggleGroupItem value="tiktok" aria-label="TikTok" disabled={tiktokDisabled}>
            TikTok
          </ToggleGroupItem>
        </span>
        <span title={tiktokDisabled ? (disabledReason as string) : undefined}>
          <ToggleGroupItem value="both" aria-label="Ambas" disabled={tiktokDisabled}>
            Ambas
          </ToggleGroupItem>
        </span>
      </ToggleGroup>
    </div>
  );
}
