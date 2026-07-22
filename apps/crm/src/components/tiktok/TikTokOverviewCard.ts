// =============================================
// Mesaas - TikTok Overview Card Component
// =============================================
import { syncTikTokData, disconnectTikTok, getTikTokAuthUrl } from '../../services/tiktok';
import type { TikTokAccount } from '../../services/tiktok';
import { openModal, closeModal, escapeHTML, sanitizeUrl } from '../../router';
import { toast } from 'sonner';
import { formatDate } from '../../store';
import { i18n } from '@mesaas/i18n';

function t(key: string, opts?: Record<string, unknown>) {
  return i18n.t(key, { ns: 'clients', ...opts });
}

function numFmt(n: number | null | undefined) {
  const locale = i18n.language === 'en' ? 'en-US' : 'pt-BR';
  return (n ?? 0).toLocaleString(locale);
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function renderTikTokOverviewCard(
  container: HTMLElement,
  clientId: number,
  account: TikTokAccount,
  onRefresh: () => void,
) {
  const status = account.authorization_status;
  const isRevoked = status === 'revoked';
  const isExpired = status === 'expired';
  const isDisconnected = status === 'disconnected';

  let statusBanner = '';
  if (isRevoked) {
    statusBanner = `<div style="background: rgba(245, 90, 66, 0.08); color: var(--danger); padding: 0.5rem 0.75rem; border-radius: 8px; font-size: 0.8rem; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem;"><i class="ph ph-warning"></i> ${escapeHTML(t('tiktok.revokedBanner') as string)}
      <button id="btn-tt-reconnect" style="margin-left: auto; background: var(--danger); color: #fff; border: none; padding: 0.25rem 0.75rem; border-radius: 6px; font-size: 0.75rem; font-weight: 600; cursor: pointer; white-space: nowrap;">${escapeHTML(t('tiktok.reconnectButton') as string)}</button>
    </div>`;
  } else if (isExpired) {
    statusBanner = `<div style="background: rgba(245, 163, 66, 0.08); color: var(--warning); padding: 0.5rem 0.75rem; border-radius: 8px; font-size: 0.8rem; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem;">
      <i class="ph ph-warning"></i> ${escapeHTML(t('tiktok.expiredBanner') as string)}
      <button id="btn-tt-reconnect" style="margin-left: auto; background: var(--warning); color: #fff; border: none; padding: 0.25rem 0.75rem; border-radius: 6px; font-size: 0.75rem; font-weight: 600; cursor: pointer; white-space: nowrap;">${escapeHTML(t('tiktok.reconnectButton') as string)}</button>
    </div>`;
  } else if (isDisconnected) {
    statusBanner = `<div style="background: rgba(148, 163, 184, 0.12); color: var(--text-muted); padding: 0.5rem 0.75rem; border-radius: 8px; font-size: 0.8rem; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem;">
      <i class="ph ph-plugs"></i> ${escapeHTML(t('tiktok.disconnectedBanner') as string)}
      <button id="btn-tt-reconnect" style="margin-left: auto; background: var(--primary-color); color: #12151a; border: none; padding: 0.25rem 0.75rem; border-radius: 6px; font-size: 0.75rem; font-weight: 600; cursor: pointer; white-space: nowrap;">${escapeHTML(t('tiktok.reconnectButton') as string)}</button>
    </div>`;
  } else if (account.refresh_token_expires_at) {
    const daysLeft = Math.ceil(
      (new Date(account.refresh_token_expires_at).getTime() - Date.now()) / DAY_MS,
    );
    if (daysLeft <= 30) {
      statusBanner = `<div style="background: rgba(245, 163, 66, 0.08); color: var(--warning); padding: 0.5rem 0.75rem; border-radius: 8px; font-size: 0.8rem; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem;" data-tooltip="${escapeHTML(t('tiktok.refreshTokenSoonTooltip') as string)}">
        <i class="ph ph-clock"></i> ${escapeHTML(t('tiktok.refreshTokenSoonBanner') as string)}
        <button id="btn-tt-reconnect" style="margin-left: auto; background: var(--warning); color: #fff; border: none; padding: 0.25rem 0.75rem; border-radius: 6px; font-size: 0.75rem; font-weight: 600; cursor: pointer; white-space: nowrap;">${escapeHTML(t('tiktok.reconnectButton') as string)}</button>
      </div>`;
    }
  }

  const updatedDate = account.last_synced_at
    ? t('tiktok.updatedAt', { date: formatDate(account.last_synced_at.split('T')[0]) })
    : t('tiktok.updatedNow');

  const avatarUrl = account.avatar_url
    ? sanitizeUrl(account.avatar_url)
    : 'https://ui-avatars.com/api/?name=TT&background=random';
  const displayLabel = account.username
    ? `@${account.username}`
    : account.display_name || (t('tiktok.account') as string);

  // Translation values from static JSON, user data escaped via escapeHTML/sanitizeUrl.
  container.innerHTML = `
    <div class="card animate-up" style="position: relative; margin-bottom: 1.5rem;">

      ${statusBanner}

      <div style="display: flex; align-items: center; gap: 1.5rem; margin-bottom: 1.5rem;">
         <img src="${avatarUrl}" alt="TikTok" style="width: 80px; height: 80px; border-radius: 50%; object-fit: cover; border: 3px solid #000000;" />
         <div style="flex: 1; min-width: 0;">
            <h3 class="text-xl font-bold tracking-tight text-foreground flex items-center gap-2 mb-1">
                ${escapeHTML(displayLabel)}
                <i class="fa-brands fa-tiktok" style="color: #000000; font-size: 1.1rem;"></i>
            </h3>
            <p style="color: var(--text-muted); font-size: 0.85rem; margin: 0;">${escapeHTML(updatedDate as string)}</p>
         </div>
         <div style="display: flex; gap: 0.5rem; flex-shrink: 0;">
            <button id="btn-tt-sync" class="btn-icon" data-tooltip="${escapeHTML(t('tiktok.syncTooltip') as string)}" data-tooltip-dir="bottom" style="color: var(--text-muted);"><i class="ph ph-arrows-clockwise"></i></button>
            <button id="btn-tt-disconnect" class="btn-icon" data-tooltip="${escapeHTML(t('tiktok.disconnectTooltip') as string)}" data-tooltip-dir="bottom" style="color: var(--danger);"><i class="ph ph-plugs"></i></button>
         </div>
      </div>

      <div class="kpi-grid">
         <div class="kpi-card">
            <span class="kpi-label">${escapeHTML(t('tiktok.followers') as string)}</span>
            <span class="kpi-value">${numFmt(account.follower_count)}</span>
         </div>
         <div class="kpi-card">
            <span class="kpi-label">${escapeHTML(t('tiktok.totalLikes') as string)}</span>
            <span class="kpi-value">${numFmt(account.likes_count)}</span>
         </div>
         <div class="kpi-card">
            <span class="kpi-label">${escapeHTML(t('tiktok.videos') as string)}</span>
            <span class="kpi-value">${numFmt(account.video_count)}</span>
         </div>
      </div>
    </div>
  `;

  // Bind Sync
  const btnSync = container.querySelector('#btn-tt-sync') as HTMLButtonElement;
  if (btnSync) {
    btnSync.addEventListener('click', async () => {
      try {
        btnSync.innerHTML = '<i class="ph ph-spinner ph-spin"></i>';
        btnSync.disabled = true;
        const result = await syncTikTokData(clientId);
        toast.success(
          t('tiktok.syncSuccess', {
            synced: result.synced_posts ?? 0,
            refreshed: result.refreshed_posts ?? 0,
          }) as string,
        );
        onRefresh();
      } catch (err: any) {
        btnSync.innerHTML = '<i class="ph ph-arrows-clockwise"></i>';
        btnSync.disabled = false;
        if (err.message === 'TOKEN_EXPIRED') {
          toast.error(t('tiktok.syncTokenExpired') as string);
        } else {
          toast.error(t('tiktok.syncError', { error: err.message }) as string);
        }
      }
    });
  }

  // Bind Reconnect (revoked / expired / disconnected / refresh-token-soon banner)
  const btnReconnect = container.querySelector('#btn-tt-reconnect') as HTMLButtonElement | null;
  if (btnReconnect) {
    btnReconnect.addEventListener('click', async () => {
      try {
        btnReconnect.innerHTML = `<i class="ph ph-spinner ph-spin"></i> ${escapeHTML(t('tiktok.connecting') as string)}`;
        btnReconnect.disabled = true;
        const url = await getTikTokAuthUrl(clientId);
        window.location.href = url;
      } catch (err: any) {
        btnReconnect.textContent = t('tiktok.reconnectButton') as string;
        btnReconnect.disabled = false;
        toast.error(t('tiktok.connectError', { error: err.message }) as string);
      }
    });
  }

  // Bind Disconnect
  const btnDisconnect = container.querySelector('#btn-tt-disconnect') as HTMLButtonElement;
  if (btnDisconnect) {
    btnDisconnect.addEventListener('click', () => {
      openModal(
        t('tiktok.disconnectTitle') as string,
        `<p style="color:var(--text-muted);line-height:1.6;">${t('tiktok.disconnectConfirm', { username: escapeHTML(account.username || (t('tiktok.account') as string)) })}</p>
             <p style="color:var(--text-muted);font-size:0.85rem;margin-top:0.5rem;">${escapeHTML(t('tiktok.disconnectWarning') as string)}</p>`,
        async () => {
          closeModal();
          try {
            btnDisconnect.innerHTML = '<i class="ph ph-spinner ph-spin"></i>';
            btnDisconnect.disabled = true;
            await disconnectTikTok(clientId);
            toast.success(t('tiktok.disconnectSuccess') as string);
            onRefresh();
          } catch (err: any) {
            btnDisconnect.innerHTML = '<i class="ph ph-plugs"></i>';
            btnDisconnect.disabled = false;
            toast.error(t('tiktok.disconnectError', { error: err.message }) as string);
          }
        },
        {
          danger: true,
          submitText: t('tiktok.disconnectButton'),
          cancelText: i18n.t('actions.cancel'),
        },
      );
    });
  }
}
