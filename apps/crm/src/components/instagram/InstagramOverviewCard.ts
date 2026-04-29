// =============================================
// Mesaas - Instagram Overview Card Component
// =============================================
import { syncInstagramData, disconnectInstagram } from '../../services/instagram';
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
  const isExpired = account.token_expires_at && new Date(account.token_expires_at) < new Date();

  let statusBanner = '';
  if (isRevoked) {
    statusBanner = `<div style="background: rgba(245, 90, 66, 0.08); color: var(--danger); padding: 0.5rem 0.75rem; border-radius: 8px; font-size: 0.8rem; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem;"><i class="ph ph-warning"></i> ${escapeHTML(t('instagram.revokedBanner'))}</div>`;
  } else if (isExpired) {
    statusBanner = `<div style="background: rgba(245, 163, 66, 0.08); color: var(--warning); padding: 0.5rem 0.75rem; border-radius: 8px; font-size: 0.8rem; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem;"><i class="ph ph-warning"></i> ${escapeHTML(t('instagram.expiredBanner'))}</div>`;
  }

  const updatedDate = (account.last_synced_at || account.updated_at)
    ? t('instagram.updatedAt', { date: formatDate((account.last_synced_at || account.updated_at).split('T')[0]) })
    : t('instagram.updatedNow');

  // Translation values from static JSON, user data escaped via escapeHTML/sanitizeUrl
  container.innerHTML = `
    <div class="card animate-up" style="position: relative; margin-bottom: 1.5rem; overflow: visible;">
      <div style="position: absolute; top: 1rem; right: 1rem; display: flex; gap: 0.5rem;">
         <button id="btn-ig-sync" class="btn-icon" data-tooltip="${escapeHTML(t('instagram.syncTooltip'))}" data-tooltip-dir="bottom" style="color: var(--text-muted);"><i class="ph ph-arrows-clockwise"></i></button>
         <button id="btn-ig-disconnect" class="btn-icon" data-tooltip="${escapeHTML(t('instagram.disconnectTooltip'))}" data-tooltip-dir="bottom" style="color: var(--danger);"><i class="ph ph-plugs"></i></button>
      </div>

      ${statusBanner}

      <div style="display: flex; align-items: center; gap: 1.5rem; margin-bottom: 1.5rem;">
         <img src="${account.profile_picture_url ? sanitizeUrl(account.profile_picture_url) : 'https://ui-avatars.com/api/?name=IG&background=random'}" alt="IG Profile" style="width: 80px; height: 80px; border-radius: 50%; object-fit: cover; border: 3px solid #E1306C;" />
         <div>
            <h3 class="text-xl font-bold tracking-tight text-foreground flex items-center gap-2 mb-1">
                ${escapeHTML(account.username || t('instagram.account'))}
                <i class="fa-brands fa-instagram" style="color: #E1306C; font-size: 1.2rem;"></i>
            </h3>
            <p style="color: var(--text-muted); font-size: 0.85rem;">${escapeHTML(updatedDate)}</p>
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
