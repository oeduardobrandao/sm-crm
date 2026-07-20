// =============================================
// Mesaas - TikTok Posts Table Component
// =============================================
import { getTikTokPosts } from '../../services/tiktok';
import { formatDate } from '../../store';
import { escapeHTML, sanitizeUrl } from '../../router';
import { i18n } from '@mesaas/i18n';

function t(key: string, opts?: Record<string, unknown>) {
  return i18n.t(key, { ns: 'clients', ...opts });
}

function numFmt(n: number | null | undefined): string {
  const locale = i18n.language === 'en' ? 'en-US' : 'pt-BR';
  return (n ?? 0).toLocaleString(locale);
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '';
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export async function renderTikTokPostsTable(container: HTMLElement, clientId: number) {
  let currentPage = 1;

  container.innerHTML = `
    <div class="card animate-up" style="margin-bottom: 1.5rem;">
       <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem;">
           <h3 class="text-xl font-bold tracking-tight mb-4 text-foreground"><i class="ph ph-video-camera" style="color: var(--primary-color); margin-right: 0.5rem;"></i> ${t('tiktok.postsTitle')}</h3>
           <div id="tt-pagination" class="pagination-controls" style="display: none; gap: 0.5rem; align-items: center;">
              <button id="btn-tt-prev" class="btn-icon" disabled><i class="ph ph-caret-left"></i></button>
              <span id="tt-page-indicator" style="font-size: 0.8rem; color: var(--text-muted); font-family: var(--font-mono);">Pg 1</span>
              <button id="btn-tt-next" class="btn-icon"><i class="ph ph-caret-right"></i></button>
           </div>
       </div>
       <div id="tt-posts-content">
          <div style="display:flex;align-items:center;justify-content:center;height:100px;">
             <i class="ph ph-spinner ph-spin" style="font-size:1.5rem;color:var(--primary-color)"></i>
          </div>
       </div>
    </div>
  `;

  const contentArea = container.querySelector('#tt-posts-content') as HTMLElement;
  const btnPrev = container.querySelector('#btn-tt-prev') as HTMLButtonElement;
  const btnNext = container.querySelector('#btn-tt-next') as HTMLButtonElement;
  const lblPage = container.querySelector('#tt-page-indicator') as HTMLElement;

  async function loadPosts(page: number) {
    try {
      contentArea.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100px;">
             <i class="ph ph-spinner ph-spin" style="font-size:1.5rem;color:var(--primary-color)"></i>
          </div>`;

      const data = await getTikTokPosts(clientId, page);
      const posts = data.posts || [];
      const total = data.total || 0;
      const totalPages = Math.max(1, Math.ceil(total / 10));

      if (posts.length === 0) {
        const noPostsEl = document.createElement('p');
        noPostsEl.style.cssText =
          'color:var(--text-muted);font-size:0.9rem;text-align:center;padding:1rem;';
        noPostsEl.textContent = t('tiktok.noPosts') as string;
        contentArea.replaceChildren(noPostsEl);
        btnPrev.disabled = true;
        btnNext.disabled = true;
        lblPage.textContent = '-';
        return;
      }

      let html = `
        <table class="data-table" style="font-size: 0.85rem;">
          <thead>
            <tr>
              <th>${escapeHTML(t('tiktok.colDate') as string)}</th>
              <th>${escapeHTML(t('tiktok.colTitle') as string)}</th>
              <th>${escapeHTML(t('tiktok.colViews') as string)}</th>
              <th>${escapeHTML(t('tiktok.colEngagement') as string)}</th>
              <th>${escapeHTML(t('tiktok.colLink') as string)}</th>
            </tr>
          </thead>
          <tbody>
      `;

      const COLLAPSED_LIMIT = 5;
      let rowIndex = 0;
      for (const p of posts) {
        const rawTitle = p.title || p.video_description || '';
        const truncatedTitle = rawTitle.length > 50 ? rawTitle.substring(0, 50) + '...' : rawTitle;
        const titleStr = escapeHTML(truncatedTitle || '—');
        const safeShareUrl = p.share_url ? sanitizeUrl(p.share_url) : '';
        const safeThumbnail = p.cover_image_url ? sanitizeUrl(p.cover_image_url) : '';
        const durationLabel = formatDuration(p.duration);

        html += `
            <tr${rowIndex >= COLLAPSED_LIMIT ? ' class="tt-row-hidden" style="display:none;"' : ''}>
              <td data-label="${escapeHTML(t('tiktok.colDate') as string)}" style="width: 140px;">
                  <div style="display:flex;align-items:center;gap:0.75rem;">
                    ${safeThumbnail && safeThumbnail !== '#' ? `<img loading="lazy" src="${safeThumbnail}" alt="" style="width:44px;height:44px;border-radius:6px;object-fit:cover;flex-shrink:0;background:var(--bg-secondary);" onerror="this.style.display='none'">` : `<div style="width:44px;height:44px;border-radius:6px;background:var(--bg-secondary);display:flex;align-items:center;justify-content:center;flex-shrink:0;"><i class="ph ph-video-camera" style="color:var(--text-muted);font-size:1.1rem;"></i></div>`}
                    <div>
                      <strong>${p.posted_at ? formatDate(p.posted_at.split('T')[0]) : '—'}</strong><br>
                      ${durationLabel ? `<span style="font-size:0.7rem;color:var(--text-muted);">${durationLabel}</span>` : ''}
                    </div>
                  </div>
              </td>
              <td data-label="${escapeHTML(t('tiktok.colTitle') as string)}" style="max-width: 200px; white-space: normal; line-height: 1.4;">
                 ${titleStr}
              </td>
              <td data-label="${escapeHTML(t('tiktok.colViews') as string)}">
                 <span style="display:flex;align-items:center;gap:0.4rem;color:var(--text-main);"><i class="ph ph-eye"></i> ${numFmt(p.views)}</span>
              </td>
              <td data-label="${escapeHTML(t('tiktok.colEngagement') as string)}">
                 <div style="display:flex;gap:0.75rem;color:var(--text-main);">
                    <span data-tooltip="${escapeHTML(t('tiktok.likes') as string)}"><i class="ph ph-heart" style="color:#FE2C55"></i> ${numFmt(p.likes)}</span>
                    <span data-tooltip="${escapeHTML(t('tiktok.comments') as string)}"><i class="ph ph-chat-circle"></i> ${numFmt(p.comments)}</span>
                    <span data-tooltip="${escapeHTML(t('tiktok.shares') as string)}"><i class="ph ph-share-network"></i> ${numFmt(p.shares)}</span>
                 </div>
              </td>
              <td data-label="${escapeHTML(t('tiktok.colLink') as string)}">
                 ${safeShareUrl && safeShareUrl !== '#' ? `<a href="${safeShareUrl}" target="_blank" rel="noopener noreferrer" class="btn-icon" style="text-decoration:none;display:inline-block;"><i class="ph ph-arrow-square-out"></i></a>` : '—'}
              </td>
            </tr>
          `;
        rowIndex++;
      }

      html += '</tbody></table>';

      if (posts.length > COLLAPSED_LIMIT) {
        html += `<button id="btn-tt-expand" style="display:flex;align-items:center;justify-content:center;gap:0.4rem;margin:0.75rem auto 0;padding:0.4rem 1rem;font-size:0.8rem;color:var(--primary-color);background:none;border:1px solid var(--border-color);border-radius:6px;cursor:pointer;transition:background 0.15s;">
          <i class="ph ph-caret-down"></i> ${escapeHTML(t('tiktok.viewMore') as string)}
        </button>`;
      }

      contentArea.innerHTML = html;

      const expandBtn = contentArea.querySelector('#btn-tt-expand') as HTMLButtonElement | null;
      if (expandBtn) {
        expandBtn.addEventListener('click', () => {
          const hidden = contentArea.querySelectorAll('.tt-row-hidden');
          const isExpanded = expandBtn.dataset.expanded === '1';
          const pagination = container.querySelector('#tt-pagination') as HTMLElement;
          hidden.forEach((r) => ((r as HTMLElement).style.display = isExpanded ? 'none' : ''));
          expandBtn.dataset.expanded = isExpanded ? '0' : '1';
          pagination.style.display = isExpanded ? 'none' : 'flex';
          const icon = expandBtn.querySelector('i')!;
          const textNode = expandBtn.childNodes[expandBtn.childNodes.length - 1];
          if (isExpanded) {
            icon.className = 'ph ph-caret-down';
            textNode.textContent = ` ${t('tiktok.viewMore')}`;
          } else {
            icon.className = 'ph ph-caret-up';
            textNode.textContent = ` ${t('tiktok.viewLess')}`;
          }
        });
      }

      // Update Pagination UI
      lblPage.textContent = t('tiktok.pageIndicator', {
        page: String(page),
        total: String(totalPages),
      }) as string;
      btnPrev.disabled = page <= 1;
      btnNext.disabled = page >= totalPages;
    } catch (err: any) {
      contentArea.innerHTML = `<p style="color:var(--danger);font-size:0.9rem;padding:1rem;">${escapeHTML(t('tiktok.postsError', { error: err.message || t('tiktok.unknownError') }) as string)}</p>`;
    }
  }

  btnPrev.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      loadPosts(currentPage);
    }
  });

  btnNext.addEventListener('click', () => {
    currentPage++;
    loadPosts(currentPage);
  });

  // Initial load
  await loadPosts(currentPage);
}
