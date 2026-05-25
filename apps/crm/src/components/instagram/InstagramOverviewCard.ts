// =============================================
// Mesaas - Instagram Overview Card Component
// =============================================
import { syncInstagramData, disconnectInstagram, getInstagramAuthUrl } from '../../services/instagram';
import { showToast, openModal, closeModal, escapeHTML, sanitizeUrl } from '../../router';
import { formatDate } from '../../store';
import { i18n } from '@mesaas/i18n';

function t(key: string, opts?: Record<string, unknown>) {
  return i18n.t(key, { ns: 'clients', ...opts });
}

function numFmt(n: number | undefined) {
  const locale = i18n.language === 'en' ? 'en-US' : 'pt-BR';
  return (n ?? 0).toLocaleString(locale);
}

export function renderInstagramOverviewCard(container: HTMLElement, clientId: number, account: any, onRefresh: () => void) {
  const isRevoked = account.authorization_status === 'revoked';
  const isExpired = account.authorization_status === 'expired' || (account.token_expires_at && new Date(account.token_expires_at) < new Date());

  let statusBanner = '';
  if (isRevoked) {
    statusBanner = `<div style="background: rgba(245, 90, 66, 0.08); color: var(--danger); padding: 0.5rem 0.75rem; border-radius: 8px; font-size: 0.8rem; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem;"><i class="ph ph-warning"></i> ${escapeHTML(t('instagram.revokedBanner'))}</div>`;
  } else if (isExpired) {
    statusBanner = `<div style="background: rgba(245, 163, 66, 0.08); color: var(--warning); padding: 0.5rem 0.75rem; border-radius: 8px; font-size: 0.8rem; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem;">
      <i class="ph ph-warning"></i> ${escapeHTML(t('instagram.expiredBanner'))}
      <button id="btn-ig-reconnect" style="margin-left: auto; background: var(--warning); color: #fff; border: none; padding: 0.25rem 0.75rem; border-radius: 6px; font-size: 0.75rem; font-weight: 600; cursor: pointer; white-space: nowrap;">${escapeHTML(t('instagram.reconnectButton'))}</button>
    </div>`;
  }

  const updatedDate = (account.last_synced_at || account.updated_at)
    ? t('instagram.updatedAt', { date: formatDate((account.last_synced_at || account.updated_at).split('T')[0]) })
    : t('instagram.updatedNow');

  let tokenBadge = '';
  if (account.token_expires_at && !isRevoked) {
    const daysLeft = Math.ceil((new Date(account.token_expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    const tooltip = escapeHTML(t('instagram.tokenTooltip'));
    const badgeBase = `cursor: help; display: inline-flex; align-items: center; gap: 0.25rem; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.7rem; font-weight: 600; font-family: var(--font-mono);`;
    if (daysLeft <= 0) {
      tokenBadge = `<span class="token-badge" data-tooltip="${tooltip}" data-tooltip-dir="bottom" style="${badgeBase} background: rgba(245, 90, 66, 0.1); color: var(--danger);"><i class="ph ph-warning" style="font-size: 0.75rem;"></i> ${escapeHTML(t('instagram.tokenExpired'))}</span>`;
    } else if (daysLeft <= 7) {
      tokenBadge = `<span class="token-badge" data-tooltip="${tooltip}" data-tooltip-dir="bottom" style="${badgeBase} background: rgba(245, 163, 66, 0.1); color: var(--warning);"><i class="ph ph-clock" style="font-size: 0.75rem;"></i> ${escapeHTML(t('instagram.tokenDaysLeft', { count: daysLeft }))}</span>`;
    } else {
      tokenBadge = `<span class="token-badge" data-tooltip="${tooltip}" data-tooltip-dir="bottom" style="${badgeBase} background: rgba(62, 207, 142, 0.1); color: var(--success);"><i class="ph ph-clock" style="font-size: 0.75rem;"></i> ${escapeHTML(t('instagram.tokenDaysLeft', { count: daysLeft }))}</span>`;
    }
  }

  // Translation values from static JSON, user data escaped via escapeHTML/sanitizeUrl
  // All dynamic values are either escaped (escapeHTML/sanitizeUrl) or computed numbers (daysLeft)
  container.innerHTML = `
    <div class="card animate-up" style="position: relative; margin-bottom: 1.5rem;">

      ${statusBanner}

      <div style="display: flex; align-items: center; gap: 1.5rem; margin-bottom: 1.5rem;">
         <img src="${account.profile_picture_url ? sanitizeUrl(account.profile_picture_url) : 'https://ui-avatars.com/api/?name=IG&background=random'}" alt="IG Profile" style="width: 80px; height: 80px; border-radius: 50%; object-fit: cover; border: 3px solid #E1306C;" />
         <div style="flex: 1; min-width: 0;">
            <h3 class="text-xl font-bold tracking-tight text-foreground flex items-center gap-2 mb-1">
                ${escapeHTML(account.username || t('instagram.account'))}
                <i class="fa-brands fa-instagram" style="color: #E1306C; font-size: 1.2rem;"></i>
            </h3>
            <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
              <p style="color: var(--text-muted); font-size: 0.85rem; margin: 0;">${escapeHTML(updatedDate)}</p>
              ${tokenBadge}
            </div>
         </div>
         <div style="display: flex; gap: 0.5rem; flex-shrink: 0;">
            <button id="btn-ig-sync" class="btn-icon" data-tooltip="${escapeHTML(t('instagram.syncTooltip'))}" data-tooltip-dir="bottom" style="color: var(--text-muted);"><i class="ph ph-arrows-clockwise"></i></button>
            <button id="btn-ig-disconnect" class="btn-icon" data-tooltip="${escapeHTML(t('instagram.disconnectTooltip'))}" data-tooltip-dir="bottom" style="color: var(--danger);"><i class="ph ph-plugs"></i></button>
         </div>
      </div>

      <div class="kpi-grid" style="margin-bottom: 1.5rem;">
         <div class="kpi-card">
            <span class="kpi-label">${escapeHTML(t('instagram.followers')).toUpperCase()}</span>
            <span class="kpi-value">${numFmt(account.follower_count)}</span>
         </div>
         <div class="kpi-card">
            <span class="kpi-label">${escapeHTML(t('instagram.following')).toUpperCase()}</span>
            <span class="kpi-value">${numFmt(account.following_count)}</span>
         </div>
         <div class="kpi-card">
            <span class="kpi-label">${escapeHTML(t('instagram.posts')).toUpperCase()}</span>
            <span class="kpi-value">${numFmt(account.media_count)}</span>
         </div>
      </div>

      <h4 style="margin-bottom: 1rem; font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em;">${escapeHTML(t('instagram.metricsTitle'))}</h4>
      <div class="kpi-grid">
         <div class="kpi-card">
            <span class="kpi-label"><i class="ph ph-users"></i> ${escapeHTML(t('instagram.reach'))}</span>
            <span class="kpi-value">${numFmt(account.reach_28d)}</span>
         </div>
         <div class="kpi-card">
            <span class="kpi-label"><i class="ph ph-eye"></i> ${escapeHTML(t('instagram.impressions'))}</span>
            <span class="kpi-value">${numFmt(account.impressions_28d)}</span>
         </div>
         <div class="kpi-card">
            <span class="kpi-label"><i class="ph ph-user-focus"></i> ${escapeHTML(t('instagram.engaged'))}</span>
            <span class="kpi-value">${numFmt(account.profile_views_28d)}</span>
         </div>
         <div class="kpi-card">
            <span class="kpi-label"><i class="ph ph-link"></i> ${escapeHTML(t('instagram.linkClicks'))}</span>
            <span class="kpi-value">${numFmt(account.website_clicks_28d)}</span>
         </div>
      </div>
    </div>
  `;

  // Bind Sync
  const btnSync = container.querySelector('#btn-ig-sync') as HTMLButtonElement;
  if (btnSync) {
      btnSync.addEventListener('click', async () => {
          try {
             btnSync.innerHTML = '<i class="ph ph-spinner ph-spin"></i>';
             btnSync.disabled = true;
             await syncInstagramData(clientId);
             showToast(t('instagram.syncSuccess'));
             onRefresh();
          } catch (err: any) {
             btnSync.innerHTML = '<i class="ph ph-arrows-clockwise"></i>';
             btnSync.disabled = false;
             if (err.message === 'TOKEN_EXPIRED') {
                 showToast(t('instagram.syncTokenExpired'), 'error');
             } else {
                 showToast(t('instagram.syncError', { error: err.message }), 'error');
             }
          }
      });
  }

  // Bind Reconnect
  const btnReconnect = container.querySelector('#btn-ig-reconnect') as HTMLButtonElement;
  if (btnReconnect) {
      btnReconnect.addEventListener('click', async () => {
          try {
             btnReconnect.innerHTML = `<i class="ph ph-spinner ph-spin"></i> ${escapeHTML(t('instagram.connecting'))}`;
             btnReconnect.disabled = true;
             const url = await getInstagramAuthUrl(clientId);
             window.location.href = url;
          } catch (err: any) {
             btnReconnect.textContent = escapeHTML(t('instagram.reconnectButton'));
             btnReconnect.disabled = false;
             showToast(t('instagram.connectError', { error: err.message }), 'error');
          }
      });
  }

  // Bind Disconnect
  const btnDisconnect = container.querySelector('#btn-ig-disconnect') as HTMLButtonElement;
  if (btnDisconnect) {
      btnDisconnect.addEventListener('click', () => {
          openModal(
            t('instagram.disconnectTitle'),
            `<p style="color:var(--text-muted);line-height:1.6;">${t('instagram.disconnectConfirm', { username: escapeHTML(account.username || t('instagram.account')) })}</p>
             <p style="color:var(--text-muted);font-size:0.85rem;margin-top:0.5rem;">${escapeHTML(t('instagram.disconnectWarning'))}</p>`,
            async () => {
              closeModal();
              try {
                btnDisconnect.innerHTML = '<i class="ph ph-spinner ph-spin"></i>';
                btnDisconnect.disabled = true;
                await disconnectInstagram(clientId);
                showToast(t('instagram.disconnectSuccess'));
                onRefresh();
              } catch (err: any) {
                btnDisconnect.innerHTML = '<i class="ph ph-plugs"></i>';
                btnDisconnect.disabled = false;
                showToast(t('instagram.disconnectError', { error: err.message }), 'error');
              }
            },
            { danger: true, submitText: t('instagram.disconnectButton'), cancelText: i18n.t('actions.cancel') }
          );
      });
  }
}
