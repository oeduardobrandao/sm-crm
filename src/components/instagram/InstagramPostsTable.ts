// =============================================
// CRM Fluxo - Instagram Posts Table Component
// =============================================
import { getInstagramPosts } from '../../services/instagram';
import { formatDate } from '../../store';

export async function renderInstagramPostsTable(container: HTMLElement, clientId: number) {
  let currentPage = 1;

  container.innerHTML = `
    <div class="card animate-up">
       <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem;">
           <h3><i class="ph ph-images" style="color: var(--primary-color); margin-right: 0.5rem;"></i> Últimas Publicações</h3>
           <div class="pagination-controls" style="display: flex; gap: 0.5rem; align-items: center;">
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

      for (const p of posts) {
          const captionStr = p.caption ? (p.caption.length > 50 ? p.caption.substring(0, 50) + '...' : p.caption) : '—';
          
          html += `
            <tr>
              <td data-label="Data">
                  <strong>${formatDate(p.posted_at.split('T')[0])}</strong><br>
                  <span style="font-size:0.7rem;color:var(--text-muted);">${p.media_type}</span>
              </td>
              <td data-label="Legenda" style="max-width: 200px; white-space: normal; line-height: 1.4;">
                 ${captionStr}
              </td>
              <td data-label="Engajamento">
                 <div style="display:flex;gap:0.75rem;color:var(--text-main);">
                    <span data-tooltip="Curtidas"><i class="ph ph-heart" style="color:#e25563"></i> ${p.likes}</span>
                    <span data-tooltip="Comentários"><i class="ph ph-chat-circle"></i> ${p.comments}</span>
                 </div>
              </td>
              <td data-label="Desempenho">
                 <div style="display:flex;gap:0.75rem;color:var(--text-muted);">
                    <span data-tooltip="Alcançadas"><i class="ph ph-users"></i> ${p.reach || 0}</span>
                    <span data-tooltip="Impressões"><i class="ph ph-eye"></i> ${p.impressions || 0}</span>
                 </div>
              </td>
              <td data-label="Link">
                 <a href="${p.permalink}" target="_blank" class="btn-icon" style="text-decoration:none;display:inline-block;"><i class="ph ph-arrow-square-out"></i></a>
              </td>
            </tr>
          `;
      }

      html += '</tbody></table>';
      contentArea.innerHTML = html;

      // Update Pagination UI
      lblPage.textContent = `Pg ${page} de ${totalPages}`;
      btnPrev.disabled = page <= 1;
      btnNext.disabled = page >= totalPages;

    } catch (err: any) {
        contentArea.innerHTML = `<p style="color:var(--danger);font-size:0.9rem;padding:1rem;">Erro ao carregar posts: ${err.message}</p>`;
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
