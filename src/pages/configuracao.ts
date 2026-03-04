// =============================================
// Página: Configuração do Usuário
// =============================================
import { supabase, getCurrentUser, getCurrentProfile, signOut } from '../lib/supabase';
import { showToast, navigate } from '../router';

export async function renderConfiguracao(container: HTMLElement): Promise<void> {
  const user = await getCurrentUser();
  const profile = await getCurrentProfile();

  if (!user || !profile) {
    navigate('/login');
    return;
  }

  container.innerHTML = `
    <header class="header animate-up">
      <div class="header-title">
        <h1>Configurações</h1>
        <p>Gerencie seu perfil e preferências.</p>
      </div>
    </header>

    <div class="config-grid animate-up">
      <!-- Profile Card -->
      <div class="card config-profile-card">
        <div class="config-avatar">
          <div class="avatar" style="width:80px; height:80px; font-size:2rem; background: var(--primary-color)">
            ${profile.nome ? profile.nome.split(' ').map((w: string) => w[0]).join('').substring(0, 2).toUpperCase() : 'U'}
          </div>
          <div>
            <h3>${profile.nome || 'Usuário'}</h3>
            <p style="color:var(--text-muted); font-size:0.85rem">${user.email}</p>
            <span class="badge badge-success" style="margin-top:0.25rem">Conta Ativa</span>
          </div>
        </div>
      </div>

      <!-- Profile Form -->
      <div class="card">
        <h3 style="margin-bottom:1.5rem"><i class="fa-solid fa-user-pen" style="margin-right:0.5rem; color:var(--primary-color)"></i> Dados do Perfil</h3>
        <form id="profile-form" class="modal-body">
          <div class="form-row">
            <div class="form-group">
              <label>Nome Completo</label>
              <input type="text" name="nome" value="${profile.nome || ''}" class="form-input" required>
            </div>
            <div class="form-group">
              <label>Empresa</label>
              <input type="text" name="empresa" value="${profile.empresa || ''}" class="form-input">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Telefone</label>
              <input type="text" name="telefone" value="${profile.telefone || ''}" class="form-input" placeholder="(11) 99999-0000">
            </div>
            <div class="form-group">
              <label>E-mail</label>
              <input type="email" value="${user.email}" class="form-input" disabled style="opacity:0.6">
            </div>
          </div>
          <div style="display:flex; justify-content:flex-end; gap:0.75rem; margin-top:0.5rem">
            <button type="submit" class="btn-primary" id="btn-save-profile">
              <i class="fa-solid fa-check"></i> Salvar Alterações
            </button>
          </div>
        </form>
      </div>

      <!-- Security -->
      <div class="card">
        <h3 style="margin-bottom:1.5rem"><i class="fa-solid fa-shield-halved" style="margin-right:0.5rem; color:var(--primary-color)"></i> Segurança</h3>
        <form id="password-form" class="modal-body">
          <div class="form-row">
            <div class="form-group">
              <label>Nova Senha</label>
              <input type="password" name="newPassword" class="form-input" placeholder="Mínimo 6 caracteres" minlength="6">
            </div>
            <div class="form-group">
              <label>Confirmar Nova Senha</label>
              <input type="password" name="confirmPassword" class="form-input" placeholder="Repita a senha">
            </div>
          </div>
          <div style="display:flex; justify-content:flex-end; gap:0.75rem; margin-top:0.5rem">
            <button type="submit" class="btn-secondary" id="btn-change-pass">
              <i class="fa-solid fa-key"></i> Alterar Senha
            </button>
          </div>
        </form>
      </div>

      <!-- Account Info -->
      <div class="card">
        <h3 style="margin-bottom:1.5rem"><i class="fa-solid fa-circle-info" style="margin-right:0.5rem; color:var(--primary-color)"></i> Informações da Conta</h3>
        <div class="config-info-grid">
          <div class="config-info-item">
            <span class="config-info-label">ID da Conta</span>
            <span class="config-info-value" style="font-family:monospace; font-size:0.7rem">${user.id.substring(0, 18)}...</span>
          </div>
          <div class="config-info-item">
            <span class="config-info-label">Criado em</span>
            <span class="config-info-value">${new Date(user.created_at).toLocaleDateString('pt-BR')}</span>
          </div>
          <div class="config-info-item">
            <span class="config-info-label">Último login</span>
            <span class="config-info-value">${user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleDateString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'N/A'}</span>
          </div>
          <div class="config-info-item">
            <span class="config-info-label">Provedor</span>
            <span class="config-info-value">Email/Senha</span>
          </div>
        </div>
        <div style="margin-top:1.5rem; border-top:1px solid var(--border-color); padding-top:1.5rem">
          <button class="btn-danger-outline" id="btn-logout">
            <i class="fa-solid fa-right-from-bracket"></i> Sair da Conta
          </button>
        </div>
      </div>
    </div>
  `;

  // --- Save Profile ---
  container.querySelector('#profile-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const data = new FormData(form);

    const { error } = await supabase.from('profiles').update({
      nome: data.get('nome') as string,
      empresa: data.get('empresa') as string,
      telefone: data.get('telefone') as string,
      updated_at: new Date().toISOString(),
    }).eq('id', user.id);

    if (error) {
      showToast('Erro ao salvar: ' + error.message, 'error');
    } else {
      showToast('Perfil atualizado com sucesso!');
      // Update sidebar avatar initials
      const avatarEl = document.querySelector('.sidebar .avatar');
      const nome = data.get('nome') as string;
      if (avatarEl && nome) {
        avatarEl.textContent = nome.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
      }
    }
  });

  // --- Change Password ---
  container.querySelector('#password-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const data = new FormData(form);
    const newPass = data.get('newPassword') as string;
    const confirmPass = data.get('confirmPassword') as string;

    if (!newPass) { showToast('Digite a nova senha.', 'error'); return; }
    if (newPass !== confirmPass) { showToast('As senhas não conferem.', 'error'); return; }

    const { error } = await supabase.auth.updateUser({ password: newPass });
    if (error) {
      showToast('Erro: ' + error.message, 'error');
    } else {
      showToast('Senha alterada com sucesso!');
      form.reset();
    }
  });

  // --- Logout ---
  container.querySelector('#btn-logout')?.addEventListener('click', async () => {
    await signOut();
    showToast('Você saiu da conta.', 'info');
    navigate('/login');
  });
}
