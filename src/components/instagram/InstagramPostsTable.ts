// =============================================
// Mesaas - Instagram Posts Table Component
// =============================================
import { getInstagramPosts } from '../../services/instagram';
import { formatDate } from '../../store';
import { escapeHTML, sanitizeUrl } from '../../router';

export async function renderInstagramPostsTable(container: HTMLElement, clientId: number) {
  let currentPage = 1;

  container.innerHTML = `
    <div class="card animate-up" style="margin-bottom: 1.5rem;">
       <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem;">
           <h3><i class="ph ph-images" style="color: var(--primary-color); margin-right: 0.5rem;"></i> Últimas Publicações</h3>
           <div id="ig-pagination" class="pagination-controls" style="display: none; gap: 0.5rem; align-items: center;">
              <button id="btn-ig-prev" class="btn-icon" disabled><i class="ph ph-caret-left"></i></button>
              <span id="ig-page-indicator" style="font-size: 0.8rem; color: var(--text-muted); font-family: var(--font-mono);">Pg 1</span>
              <button id="btn-ig-next" class="btn-icon"><i class="ph ph-caret-right"></i></button>
           </div>
       </div>
       <div id="ig-posts-content">
          <div style="display:flex;align-items:center;justify-content:center;height:100px;">
             <i class="ph ph-spinner ph-spin" style="font-size:1.5rem;color:var(--primary-color)"></i>
          </div>
       </div>
    </div>
  `;

  const contentArea = container.querySelector('#ig-posts-content') as HTMLElement;
  const btnPrev = container.querySelector('#btn-ig-prev') as HTMLButtonElement;
  const btnNext = container.querySelector('#btn-ig-next') as HTMLButtonElement;
  const lblPage = container.querySelector('#ig-page-indicator') as HTMLElement;

  async function loadPosts(page: number) {
    try {
      contentArea.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100px;">
             <i class="ph ph-spinner ph-spin" style="font-size:1.5rem;color:var(--primary-color)"></i>
          </div>`;
          
      const data = await getInstagramPosts(clientId, page);
      const posts = data.posts || [];
      const total = data.total || 0;
      const totalPages = Math.ceil(total / 10);

      if (posts.length === 0) {
          contentArea.innerHTML = '<p style="color:var(--text-muted);font-size:0.9rem;text-align:center;padding:1rem;">Nenhuma publicação encontrada.</p>';
          btnPrev.disabled = true;
          btnNext.disabled = true;
          lblPage.textContent = '-';
          return;
      }

      let html = `
        <table class="data-table" style="font-size: 0.85rem;">
          <thead>
            <tr>
              <th>Data</th>
              <th>Legenda</th>
              <th>Engajamento</th>
              <th>Desempenho</th>
              <th>Link</th>
            </tr>
          </thead>
          <tbody>
      `;

      const COLLAPSED_LIMIT = 5;
      let rowIndex = 0;
      for (const p of posts) {
          const rawCaption = p.caption ? (p.caption.length > 50 ? p.caption.substring(0, 50) + '...' : p.caption) : '—';
          const captionStr = escapeHTML(rawCaption);
          const safePermalink = sanitizeUrl(p.permalink || '');
          const safeThumbnail = p.thumbnail_url ? sanitizeUrl(p.thumbnail_url) : '';

          html += `
            <tr${rowIndex >= COLLAPSED_LIMIT ? ' class="ig-row-hidden" style="display:none;"' : ''}>
              <td data-label="Data" style="width: 140px;">
                  <div style="display:flex;align-items:center;gap:0.75rem;">
                    ${safeThumbnail ? `<img loading="lazy" src="${safeThumbnail}" alt="" style="width:44px;height:44px;border-radius:6px;object-fit:cover;flex-shrink:0;background:var(--bg-secondary);" onerror="this.style.display='none'">` : `<div style="width:44px;height:44px;border-radius:6px;background:var(--bg-secondary);display:flex;align-items:center;justify-content:center;flex-shrink:0;"><i class="ph ph-image" style="color:var(--text-muted);font-size:1.1rem;"></i></div>`}
                    <div>
                      <strong>${formatDate(p.posted_at.split('T')[0])}</strong><br>
                      <span style="font-size:0.7rem;color:var(--text-muted);">${escapeHTML(p.media_type)}</span>
                    </div>
                  </div>
              </td>
              <td data-label="Legenda" style="max-width: 200px; white-space: normal; line-height: 1.4;">
                 ${captionStr}
              </td>
              <td data-label="Engajamento">
                 <div style="display:flex;gap:0.75rem;color:var(--text-main);">
                    <span data-tooltip="Curtidas"><i class="ph ph-heart" style="color:#e25563"></i> ${Number(p.likes) || 0}</span>
                    <span data-tooltip="Comentários"><i class="ph ph-chat-circle"></i> ${Number(p.comments) || 0}</span>
                 </div>
              </td>
              <td data-label="Desempenho">
                 <div style="display:flex;gap:0.75rem;color:var(--text-muted);">
                    <span data-tooltip="Alcançadas"><i class="ph ph-users"></i> ${p.reach || 0}</span>
                    <span data-tooltip="Impressões"><i class="ph ph-eye"></i> ${p.impressions || 0}</span>
                 </div>
              </td>
              <td data-label="Link">
                 ${safePermalink ? `<a href="${safePermalink}" target="_blank" class="btn-icon" style="text-decoration:none;display:inline-block;"><i class="ph ph-arrow-square-out"></i></a>` : '—'}
              </td>
            </tr>
          `;
          rowIndex++;
      }

      html += '</tbody></table>';

      if (posts.length > COLLAPSED_LIMIT) {
        html += `<button id="btn-ig-expand" style="display:flex;align-items:center;justify-content:center;gap:0.4rem;margin:0.75rem auto 0;padding:0.4rem 1rem;font-size:0.8rem;color:var(--primary-color);background:none;border:1px solid var(--border-color);border-radius:6px;cursor:pointer;transition:background 0.15s;">
          <i class="ph ph-caret-down"></i> Ver mais publicações
        </button>`;
      }

      contentArea.innerHTML = html;

      const expandBtn = contentArea.querySelector('#btn-ig-expand') as HTMLButtonElement | null;
      if (expandBtn) {
        expandBtn.addEventListener('click', () => {
          const hidden = contentArea.querySelectorAll('.ig-row-hidden');
          const isExpanded = expandBtn.dataset.expanded === '1';
          const pagination = container.querySelector('#ig-pagination') as HTMLElement;
          hidden.forEach(r => (r as HTMLElement).style.display = isExpanded ? 'none' : '');
          expandBtn.dataset.expanded = isExpanded ? '0' : '1';
          pagination.style.display = isExpanded ? 'none' : 'flex';
          const icon = expandBtn.querySelector('i')!;
          const textNode = expandBtn.childNodes[expandBtn.childNodes.length - 1];
          if (isExpanded) {
            icon.className = 'ph ph-caret-down';
            textNode.textContent = ' Ver mais publicações';
          } else {
            icon.className = 'ph ph-caret-up';
            textNode.textContent = ' Ver menos';
          }
        });
      }

      // Update Pagination UI
      lblPage.textContent = `Pg ${page} de ${totalPages}`;
      btnPrev.disabled = page <= 1;
      btnNext.disabled = page >= totalPages;

    } catch (err: any) {
        contentArea.innerHTML = `<p style="color:var(--danger);font-size:0.9rem;padding:1rem;">Erro ao carregar posts: ${escapeHTML(err.message || 'Erro desconhecido')}</p>`;
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
