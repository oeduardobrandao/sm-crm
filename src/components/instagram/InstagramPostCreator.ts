// =============================================
// CRM Fluxo - Instagram Post Creator Component
// =============================================
import { publishInstagramPost } from '../../services/instagram';
import { showToast } from '../../router';

export function renderInstagramPostCreator(container: HTMLElement, clientId: number, onPublished: () => void) {
  container.innerHTML = `
    <div class="card animate-up" style="margin-bottom: 2rem; border-left: 4px solid var(--primary-color);">
       <h3 style="margin-bottom: 1rem;"><i class="ph ph-paper-plane-tilt" style="color: var(--primary-color); margin-right: 0.5rem;"></i> Nova Publicação</h3>
       <p style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 1.5rem;">
          Crie uma nova publicação para o Instagram deste cliente diretamente pelo CRM.
       </p>
       
       <form id="ig-publish-form" style="display: flex; flex-direction: column; gap: 1rem;">
          <div class="form-group">
              <label style="font-size: 0.85rem; font-weight: 600; color: var(--text-muted);">Mídia (URL da Imagem)</label>
              <input type="url" id="ig-post-image" class="form-input" placeholder="https://exemplo.com/imagem.jpg" required value="https://images.unsplash.com/photo-1611162617474-5b21e879e113?w=500&q=80">
              <span style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem; display: block;">Insira um link direto para a imagem desejada. Mantivemos uma imagem padrão para testes.</span>
          </div>

          <div class="form-group">
              <label style="font-size: 0.85rem; font-weight: 600; color: var(--text-muted);">Legenda</label>
              <textarea id="ig-post-caption" class="form-input" rows="4" placeholder="Escreva a legenda da sua publicação aqui..." required></textarea>
          </div>

          <div style="display: flex; justify-content: flex-end; margin-top: 0.5rem;">
              <button type="submit" id="btn-ig-publish" class="btn-primary">
                  <i class="ph ph-paper-plane-right"></i> Publicar no Instagram
              </button>
          </div>
       </form>
    </div>
  `;

  const form = container.querySelector('#ig-publish-form') as HTMLFormElement;
  const btnSubmit = container.querySelector('#btn-ig-publish') as HTMLButtonElement;
  const imageInput = container.querySelector('#ig-post-image') as HTMLInputElement;
  const captionInput = container.querySelector('#ig-post-caption') as HTMLTextAreaElement;

  if (form) {
      form.addEventListener('submit', async (e) => {
          e.preventDefault();
          
          const caption = captionInput.value.trim();
          const imageUrl = imageInput.value.trim();

          if (!caption) {
              showToast('A legenda é obrigatória.', 'error');
              return;
          }

          try {
              const originalText = btnSubmit.innerHTML;
              btnSubmit.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Publicando...';
              btnSubmit.disabled = true;

              await publishInstagramPost(clientId, caption, imageUrl);
              
              showToast('Publicação enviada com sucesso para o Instagram!');
              
              // Clear the form
              captionInput.value = '';
              btnSubmit.innerHTML = originalText;
              btnSubmit.disabled = false;
              
              // Notify parent to refresh the posts table
              onPublished();
              
          } catch (err: any) {
              btnSubmit.innerHTML = '<i class="ph ph-paper-plane-right"></i> Publicar no Instagram';
              btnSubmit.disabled = false;
              showToast('Erro ao publicar: ' + err.message, 'error');
          }
      });
  }
}
