// =============================================
// Página: Configuração do Usuário
// =============================================
import { supabase, getCurrentUser, getCurrentProfile, signOut } from '../lib/supabase';
import { showToast, navigate, openModal, closeModal, openConfirm } from '../router';
import { getWorkspaceUsers, updateWorkspaceUserRole, removeWorkspaceUser } from '../store';
import { getInitials } from '../store';

export async function renderConfiguracao(container: HTMLElement): Promise<void> {
  const user = await getCurrentUser();
  const profile = await getCurrentProfile();

  if (!user || !profile) {
    navigate('/login');
    return;
  }

  let workspaceHtml = '';
  let wUsers: any[] = [];
  if (profile.role === 'owner' || profile.role === 'admin') {
     try {
       wUsers = await getWorkspaceUsers();
       const roleLabel = (r: string) => r === 'owner' ? 'Proprietário' : r === 'admin' ? 'Administrador' : 'Agente';

       workspaceHtml = `
       <div class="card" style="margin-top: 1.5rem">
         <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:1.5rem">
           <h3><i class="ph ph-users" style="margin-right:0.5rem; color:var(--primary-color)"></i> Membros do Workspace</h3>
           <button class="btn-primary" id="btn-invite-user" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;"><i class="ph ph-user-plus"></i> Convidar</button>
         </div>
         <div class="client-list">
           ${wUsers.map(u => `
             <div class="client-row" style="background:var(--surface-main); padding: 1rem; border-radius: 12px; margin-bottom: 0.5rem; border:1px solid var(--border-color); position:relative">
               <div style="display:flex;align-items:center;gap:0.75rem">
                 <div class="avatar" style="background:var(--primary-color)">${getInitials(u.nome || 'U')}</div>
                 <div>
                   <strong>${u.nome || 'Usuário Convidado'}</strong> <br/>
                 </div>
               </div>
               <div style="display:flex;align-items:center;gap:0.5rem">
                 <span class="badge ${u.role === 'owner' ? 'badge-neutral' : u.role === 'admin' ? 'badge-success' : 'badge-warning'}">${roleLabel(u.role)}</span>
                 ${u.id !== user.id && u.role !== 'owner' ? `
                   <button class="btn-icon btn-edit-role" data-id="${u.id}" data-role="${u.role}" title="Alterar permissão" style="color:var(--text-main)"><i class="ph ph-pencil-simple"></i></button>
                   <button class="btn-icon btn-remove-user" data-id="${u.id}" data-nome="${u.nome || 'Usuário'}" title="Remover do workspace" style="color:var(--danger)"><i class="ph ph-trash"></i></button>
                 ` : ''}
               </div>
             </div>
           `).join('')}
         </div>
       </div>
       `;
     } catch(e) { console.error("Erro ao carregar workspace", e); }
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
          <div class="form-row">
            <div class="form-group">
              <label><i class="ph ph-whatsapp" style="color:var(--success)"></i> Número do WhatsApp</label>
              <input type="text" name="whatsapp" value="${profile.whatsapp || ''}" class="form-input" placeholder="Ex: 5511999990000 (Apenas Nros)">
            </div>
            <div class="form-group" style="display:flex; align-items:flex-end;">
               <label style="display:flex; align-items:center; gap:0.5rem; cursor:pointer;" class="form-input" style="border:none; background:transparent; padding:0; height: auto;">
                 <input type="checkbox" name="whatsapp_opt_in" value="true" ${profile.whatsapp_opt_in ? 'checked' : ''} style="width:20px; height:20px; accent-color:var(--primary-color)">
                 <span style="font-size:0.85rem; color:var(--text-main)">Receber resumo do dia às 08:00 AM</span>
               </label>
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

      ${workspaceHtml}

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
      whatsapp: data.get('whatsapp') as string,
      whatsapp_opt_in: !!data.get('whatsapp_opt_in'),
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

  // --- Edit Workspace User Role ---
  container.querySelectorAll('.btn-edit-role').forEach(btn => {
    btn.addEventListener('click', () => {
      const userId = (btn as HTMLElement).dataset.id!;
      const currentRole = (btn as HTMLElement).dataset.role!;
      openModal('Alterar Permissão', `
        <div class="form-group">
          <label>Permissão</label>
          <select name="role" class="form-input">
            <option value="admin" ${currentRole === 'admin' ? 'selected' : ''}>Administrador (Pode ver tudo e convidar)</option>
            <option value="agent" ${currentRole === 'agent' ? 'selected' : ''}>Agente (Não vê valores financeiros)</option>
            ${profile.role === 'owner' ? `<option value="owner" ${currentRole === 'owner' ? 'selected' : ''}>Proprietário</option>` : ''}
          </select>
        </div>
      `, async (form) => {
        const data = new FormData(form);
        const role = data.get('role') as string;
        try {
          await updateWorkspaceUserRole(userId, role);
          showToast('Permissão atualizada!');
          closeModal();
          navigate('/configuracao');
        } catch (err: unknown) {
          showToast('Erro: ' + (err instanceof Error ? err.message : 'Desconhecido'), 'error');
        }
      });
    });
  });

  // --- Remove Workspace User ---
  container.querySelectorAll('.btn-remove-user').forEach(btn => {
    btn.addEventListener('click', () => {
      const userId = (btn as HTMLElement).dataset.id!;
      const nome = (btn as HTMLElement).dataset.nome!;
      openConfirm('Remover Membro', `Remover "${nome}" do workspace? O usuário perderá o acesso.`, async () => {
        try {
          await removeWorkspaceUser(userId);
          showToast(`${nome} removido do workspace.`);
          navigate('/configuracao');
        } catch (err: unknown) {
          showToast('Erro: ' + (err instanceof Error ? err.message : 'Desconhecido'), 'error');
        }
      }, true);
    });
  });

  // --- Invite User ---
  container.querySelector('#btn-invite-user')?.addEventListener('click', () => {
    openModal('Convidar Usuário', `
      <div class="form-row">
        <div class="form-group">
          <label>E-mail do Convidado</label>
          <input type="email" name="email" class="form-input" required placeholder="email@exemplo.com">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Permissão</label>
          <select name="role" class="form-input" required>
            <option value="admin">Administrador (Pode ver tudo e convidar)</option>
            <option value="agent">Agente (Não vê valores financeiros)</option>
            ${profile.role === 'owner' ? '<option value="owner">Proprietário</option>' : ''}
          </select>
        </div>
      </div>
    `, async (form) => {
      const data = new FormData(form);
      const email = data.get('email') as string;
      const role = data.get('role') as string;
      const btn = form.querySelector('button[type="submit"]') as HTMLButtonElement;
      
      try {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Convidando...';
        
        const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-user`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
          },
          body: JSON.stringify({ email, role })
        });
        
        const result = await response.json();
        
        if (!response.ok) {
          throw new Error(result.error || 'Erro desconhecido');
        }
        
        showToast(result.message, 'success');
        closeModal();
        navigate('/configuracao'); // reload to show new user
      } catch (err: unknown) {
        showToast('Erro ao convidar: ' + (err instanceof Error ? err.message : 'Desconhecido'), 'error');
        btn.disabled = false;
        btn.innerHTML = 'Salvar';
      }
    });
  });
}
