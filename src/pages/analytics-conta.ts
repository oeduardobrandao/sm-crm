// =============================================
// Pagina: Analytics - Conta Individual
// =============================================
import { escapeHTML, sanitizeUrl, showToast, navigate } from '../router';
import { getClientes } from '../store';
import {
  getAnalyticsOverview,
  getPostsAnalytics,
  getFollowerHistory,
  getAudienceDemographics,
  getBestPostingTimes,
  getTags,
  createTag,
  deleteTag,
  assignTagToPost,
  removeTagFromPost,
  getClientReports,
  getAccountAIAnalysis,
  type KpiDelta,
  type PostAnalytics,
  type PostTag,
  type AudienceDemographics,
  type BestPostingTimes,
  type AnalyticsReport,
  type AccountAIAnalysis,
} from '../services/analytics';
import { getInstagramSummary } from '../services/instagram';

declare const Chart: any;

interface State {
  days: number;
  sort: { col: string; dir: 'asc' | 'desc' };
  expandedPostId: number | null;
}

let chartInstances: any[] = [];

function destroyCharts() {
  for (const c of chartInstances) { try { c.destroy(); } catch (_e) { /* ignore */ } }
  chartInstances = [];
}

export async function renderAnalyticsConta(container: HTMLElement, param?: string): Promise<void> {
  destroyCharts();
  const clientId = parseInt(param || '', 10);
  if (isNaN(clientId) || clientId <= 0) {
    container.innerHTML = `<div class="card"><p style="color:var(--danger)">ID de cliente inválido.</p></div>`;
    return;
  }

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:1.5rem">
      <header class="header animate-up">
        <div class="header-title">
          <div style="display:flex;align-items:center;gap:0.75rem">
            <div class="skeleton" style="width:48px;height:48px;border-radius:50%"></div>
            <div>
              <div class="skeleton" style="width:180px;height:22px;border-radius:4px;margin-bottom:6px"></div>
              <div class="skeleton" style="width:120px;height:14px;border-radius:4px"></div>
            </div>
          </div>
        </div>
        <div class="header-actions" style="display:flex;gap:0.5rem">
          <div class="skeleton" style="width:90px;height:36px;border-radius:6px"></div>
          <div class="skeleton" style="width:140px;height:36px;border-radius:6px"></div>
        </div>
      </header>

      <!-- Filter bar skeleton -->
      <div class="filter-bar animate-up">
        ${Array(4).fill('<div class="skeleton" style="width:60px;height:32px;border-radius:6px"></div>').join('')}
      </div>

      <!-- KPI skeletons -->
      <div class="kpi-grid animate-up" style="grid-template-columns:repeat(auto-fit, minmax(160px, 1fr))">
        ${Array(7).fill(`<div class="kpi-card">
          <div class="skeleton" style="width:60%;height:12px;border-radius:4px;margin-bottom:10px"></div>
          <div class="skeleton" style="width:45%;height:28px;border-radius:4px;margin-bottom:8px"></div>
          <div class="skeleton" style="width:35%;height:10px;border-radius:4px"></div>
        </div>`).join('')}
      </div>

      <!-- Chart skeletons -->
      <div class="card animate-up">
        <div class="skeleton" style="width:160px;height:18px;border-radius:4px;margin-bottom:1rem"></div>
        <div class="skeleton" style="width:100%;height:280px;border-radius:8px"></div>
      </div>

      <!-- Two-column grid skeleton (Demographics + Best Times) -->
      <div class="widgets-grid animate-up" style="grid-template-columns:1fr 1fr">
        <div class="card">
          <div class="skeleton" style="width:180px;height:18px;border-radius:4px;margin-bottom:1rem"></div>
          <div style="display:flex;gap:1rem;margin-bottom:1rem">
            <div class="skeleton" style="flex:1;height:60px;border-radius:8px"></div>
            <div class="skeleton" style="flex:1;height:60px;border-radius:8px"></div>
          </div>
          <div class="skeleton" style="width:100%;height:200px;border-radius:8px"></div>
        </div>
        <div class="card">
          <div class="skeleton" style="width:200px;height:18px;border-radius:4px;margin-bottom:1rem"></div>
          <div class="skeleton" style="width:100%;height:200px;border-radius:8px"></div>
        </div>
      </div>

      <!-- Posts table skeleton -->
      <div class="card animate-up">
        <div class="skeleton" style="width:140px;height:18px;border-radius:4px;margin-bottom:1rem"></div>
        ${Array(5).fill(`<div style="display:flex;gap:1rem;align-items:center;padding:0.75rem 0;border-bottom:1px solid rgba(255,255,255,0.05)">
          <div class="skeleton" style="width:50px;height:50px;border-radius:6px;flex-shrink:0"></div>
          <div style="flex:1">
            <div class="skeleton" style="width:70%;height:12px;border-radius:4px;margin-bottom:6px"></div>
            <div class="skeleton" style="width:40%;height:10px;border-radius:4px"></div>
          </div>
          <div class="skeleton" style="width:60px;height:12px;border-radius:4px"></div>
        </div>`).join('')}
      </div>
    </div>`;

  try {
    const clientes = await getClientes();
    const cliente = clientes.find(c => c.id === clientId);
    if (!cliente) {
      container.innerHTML = `<div class="card"><p style="color:var(--danger)">Cliente não encontrado.</p></div>`;
      return;
    }

    // Check if Instagram is connected
    const igSummary = await getInstagramSummary(clientId);
    if (!igSummary) {
      container.innerHTML = `
        <header class="header animate-up">
          <div class="header-title"><h1>Analytics</h1></div>
          <div class="header-actions"><button class="btn-secondary" onclick="window.location.hash='#/analytics'"><i class="ph ph-arrow-left"></i> Voltar</button></div>
        </header>
        <div class="card animate-up" style="text-align:center;padding:3rem">
          <i class="ph ph-instagram-logo" style="font-size:3rem;color:var(--text-muted);margin-bottom:1rem"></i>
          <h3>Instagram não conectado</h3>
          <p style="color:var(--text-muted);margin-top:0.5rem">Conecte a conta Instagram deste cliente para acessar os analytics.</p>
          <a href="#/cliente/${clientId}" class="btn-primary" style="margin-top:1rem;display:inline-block">Ir para o perfil do cliente</a>
        </div>`;
      return;
    }

    const state: State = { days: 30, sort: { col: 'posted_at', dir: 'desc' }, expandedPostId: null };
    await renderContent(container, clientId, cliente, igSummary.account, state);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido';
    if (message === 'TOKEN_EXPIRED') {
      container.innerHTML = `
        <div class="card animate-up" style="text-align:center;padding:3rem">
          <i class="ph ph-warning" style="font-size:3rem;color:var(--warning);margin-bottom:1rem"></i>
          <h3>Token do Instagram expirado</h3>
          <p style="color:var(--text-muted);margin-top:0.5rem">Reconecte a conta Instagram para continuar visualizando os analytics.</p>
          <a href="#/cliente/${param}" class="btn-primary" style="margin-top:1rem;display:inline-block">Reconectar Conta</a>
        </div>`;
    } else {
      container.innerHTML = `<div class="card"><p style="color:var(--danger)">Erro ao carregar analytics: ${escapeHTML(message)}</p></div>`;
    }
  }
}

async function renderContent(container: HTMLElement, clientId: number, cliente: any, account: any, state: State) {
  // Fetch all data in parallel (single batch)
  const [overviewRes, postsRes, historyRes, tagsData, reportsData, demoRes, onlineRes] = await Promise.all([
    getAnalyticsOverview(clientId, state.days),
    getPostsAnalytics(clientId, state.days, state.sort.col, state.sort.dir),
    getFollowerHistory(clientId, state.days),
    getTags(),
    getClientReports(clientId),
    getAudienceDemographics(clientId).catch(() => null),
    getBestPostingTimes(clientId).catch(() => null),
  ]);

  const demographicsData: AudienceDemographics | null = demoRes?.data || null;
  const bestTimesData: BestPostingTimes | null = onlineRes?.data || null;

  const overview = overviewRes.data;
  const posts = postsRes.posts;
  const history = historyRes.history;
  const postDates = historyRes.postDates;

  // Top saved posts
  const topSaved = [...posts].sort((a, b) => b.saved - a.saved).slice(0, 5);

  // Content type breakdown
  const typeMap: Record<string, { count: number; totalEng: number }> = {};
  for (const p of posts) {
    const type = formatMediaType(p.media_type);
    if (!typeMap[type]) typeMap[type] = { count: 0, totalEng: 0 };
    typeMap[type].count++;
    typeMap[type].totalEng += p.engagement_rate;
  }
  const typeBreakdown = Object.entries(typeMap).map(([type, data]) => ({
    type,
    count: data.count,
    avgEngagement: data.count > 0 ? data.totalEng / data.count : 0,
  })).sort((a, b) => b.avgEngagement - a.avgEngagement);

  // Topic performance
  const tagEngMap: Record<string, { tag: PostTag; totalEng: number; count: number }> = {};
  for (const p of posts) {
    for (const t of p.tags) {
      if (!tagEngMap[t.tag_name]) tagEngMap[t.tag_name] = { tag: t, totalEng: 0, count: 0 };
      tagEngMap[t.tag_name].totalEng += p.engagement_rate;
      tagEngMap[t.tag_name].count++;
    }
  }
  const topicStats = Object.values(tagEngMap).map(t => ({
    ...t.tag,
    avgEngagement: t.count > 0 ? t.totalEng / t.count : 0,
    count: t.count,
  })).sort((a, b) => b.avgEngagement - a.avgEngagement);

  const cacheNote = overviewRes.fromCache
    ? `<span style="font-size:0.7rem;color:var(--text-muted)">Dados de ${new Date(overviewRes.fetchedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</span>`
    : '';

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:1.5rem">
    <header class="header animate-up">
      <div class="header-title">
        <div style="display:flex;align-items:center;gap:0.75rem">
          ${account.profile_picture_url
            ? `<img src="${escapeHTML(account.profile_picture_url)}" alt="" style="width:48px;height:48px;border-radius:50%;object-fit:cover">`
            : ''}
          <div>
            <h1>${escapeHTML(cliente.nome)}</h1>
            <p>@${escapeHTML(account.username)} ${cacheNote}</p>
          </div>
        </div>
      </div>
      <div class="header-actions">
        <button class="btn-secondary" id="btn-back"><i class="ph ph-arrow-left"></i> Voltar</button>
        <button class="btn-primary" id="btn-gen-report"><i class="ph ph-file-html"></i> Gerar Relatório</button>
      </div>
    </header>

    <!-- Time Range Selector -->
    <div class="filter-bar animate-up">
      <button class="filter-btn ${state.days === 7 ? 'active' : ''}" data-days="7">7 dias</button>
      <button class="filter-btn ${state.days === 30 ? 'active' : ''}" data-days="30">30 dias</button>
      <button class="filter-btn ${state.days === 90 ? 'active' : ''}" data-days="90">90 dias</button>
    </div>

    <!-- KPI Cards -->
    <div class="kpi-grid animate-up" style="grid-template-columns:repeat(auto-fit, minmax(160px, 1fr))">
      ${renderKpiCard('SEGUIDORES', overview.followerCount.toLocaleString('pt-BR'), overview.followers)}
      ${renderKpiCard('ENGAJAMENTO', overview.engagement.current.toFixed(2) + '%', overview.engagement)}
      ${renderKpiCard('ALCANCE', overview.reach.current.toLocaleString('pt-BR'), overview.reach)}
      ${renderKpiCard('CONTAS ENGAJADAS', overview.profileViews.current.toLocaleString('pt-BR'), overview.profileViews)}
      ${renderKpiCard('CLIQUES NO LINK', overview.websiteClicks.current.toLocaleString('pt-BR'), overview.websiteClicks)}
      ${renderKpiCard('TAXA DE SALVAMENTOS', overview.savesRate.current.toFixed(2) + '%', overview.savesRate)}
      ${renderKpiCard('POSTS PUBLICADOS', String(overview.postsPublished.current), overview.postsPublished)}
    </div>

    <!-- Saves Rate Highlight -->
    ${topSaved.length > 0 ? `
    <div class="analytics-callout animate-up" style="border-left-color:var(--primary-color);background:rgba(234,179,8,0.03)">
      <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem">
        <i class="ph ph-bookmark-simple" style="color:var(--primary-color);font-size:1.2rem"></i>
        <strong>Taxa de Salvamentos</strong>
      </div>
      <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:0.75rem">
        Salvamentos indicam que alguem guardou o conteúdo para uma decisão de saúde. É a métrica mais subestimada para conteúdo médico.
      </p>
      <div style="display:flex;flex-wrap:wrap;gap:0.5rem">
        ${topSaved.map(p => `
          <div style="background:var(--card-bg);border:1px solid var(--border-color,rgba(0,0,0,0.08));border-radius:8px;padding:0.5rem 0.75rem;font-size:0.8rem">
            <strong>${p.saved}</strong> salvamentos
            <span style="color:var(--text-muted);margin-left:0.25rem">(${p.saves_rate.toFixed(1)}% taxa)</span>
            <div style="font-size:0.7rem;color:var(--text-muted);margin-top:2px">${escapeHTML((p.caption || '').slice(0, 60))}${(p.caption || '').length > 60 ? '...' : ''}</div>
          </div>
        `).join('')}
      </div>
    </div>` : ''}

    <!-- Follower Growth Chart -->
    <div class="card animate-up">
      <h3>Crescimento de Seguidores</h3>
      ${history.length < 2
        ? '<p style="color:var(--text-muted);margin-top:1rem">Dados insuficientes. O histórico é construído diariamente.</p>'
        : `<div style="position:relative;height:280px;margin-top:1rem"><canvas id="follower-chart"></canvas></div>`}
    </div>

    <!-- Content Performance Table -->
    <div class="card animate-up">
      <h3>Performance de Conteúdo</h3>
      ${posts.length === 0
        ? '<p style="color:var(--text-muted);margin-top:1rem">Nenhuma publicação neste período.</p>'
        : `
      <div style="overflow-x:auto;margin-top:1rem">
        <table class="data-table" id="posts-table">
          <thead>
            <tr>
              <th class="sortable-header" data-col="posted_at">Data ${sortIcon(state.sort, 'posted_at')}</th>
              <th>Tipo</th>
              <th class="sortable-header" data-col="reach">Alcance ${sortIcon(state.sort, 'reach')}</th>
              <th class="sortable-header" data-col="engagement_rate">Eng. ${sortIcon(state.sort, 'engagement_rate')}</th>
              <th class="sortable-header" data-col="saved">Salvos ${sortIcon(state.sort, 'saved')}</th>
              <th class="sortable-header" data-col="comments">Coment. ${sortIcon(state.sort, 'comments')}</th>
              <th class="sortable-header" data-col="shares">Compart. ${sortIcon(state.sort, 'shares')}</th>
              <th>Tags</th>
            </tr>
          </thead>
          <tbody>
            ${posts.map((p, idx) => `
              <tr class="post-row${idx >= 5 ? ' perf-row-hidden' : ''}" data-post-id="${p.id}" style="cursor:pointer;${idx >= 5 ? 'display:none;' : ''}">
                <td data-label="Data">
                  <div style="display:flex;align-items:center;gap:0.75rem;">
                    ${p.thumbnail_url ? `<img loading="lazy" src="${sanitizeUrl(p.thumbnail_url)}" alt="" style="width:40px;height:40px;border-radius:6px;object-fit:cover;flex-shrink:0;background:var(--bg-secondary);" onerror="this.style.display='none'">` : `<div style="width:40px;height:40px;border-radius:6px;background:var(--bg-secondary);display:flex;align-items:center;justify-content:center;flex-shrink:0;"><i class="ph ph-image" style="color:var(--text-muted);font-size:1rem;"></i></div>`}
                    <span>${new Date(p.posted_at).toLocaleDateString('pt-BR')}</span>
                  </div>
                </td>
                <td data-label="Tipo"><span class="badge badge-info">${formatMediaType(p.media_type)}</span></td>
                <td data-label="Alcance">${p.reach.toLocaleString('pt-BR')}</td>
                <td data-label="Eng."><span class="badge ${p.engagement_rate >= 5 ? 'badge-success' : p.engagement_rate >= 2 ? 'badge-warning' : 'badge-neutral'}">${p.engagement_rate.toFixed(1)}%</span></td>
                <td data-label="Salvos">${p.saved}</td>
                <td data-label="Coment.">${p.comments}</td>
                <td data-label="Compart.">${p.shares}</td>
                <td data-label="Tags">
                  ${p.tags.map(t => `<span class="tag-pill" style="background:${escapeHTML(t.color)}20;color:${escapeHTML(t.color)};border:1px solid ${escapeHTML(t.color)}40">${escapeHTML(t.tag_name)}</span>`).join(' ')}
                  <button class="btn-tag-add" data-post-id="${p.id}" title="Adicionar tag" style="border:none;background:none;cursor:pointer;color:var(--text-muted);font-size:0.8rem"><i class="ph ph-plus-circle"></i></button>
                </td>
              </tr>
              ${state.expandedPostId === p.id ? `
              <tr class="post-detail-row">
                <td colspan="8" style="padding:1rem;background:var(--card-bg)">
                  <p style="font-size:0.85rem;white-space:pre-wrap;margin-bottom:0.5rem">${escapeHTML(p.caption || 'Sem legenda')}</p>
                  <div style="display:flex;gap:1rem;align-items:center;font-size:0.8rem">
                    <a href="${sanitizeUrl(p.permalink)}" target="_blank" rel="noopener" style="color:var(--primary-color)">
                      <i class="ph ph-arrow-square-out"></i> Ver no Instagram
                    </a>
                    <span style="color:var(--text-muted)">Impressoes: ${p.impressions.toLocaleString('pt-BR')}</span>
                    <span style="color:var(--text-muted)">Curtidas: ${p.likes.toLocaleString('pt-BR')}</span>
                  </div>
                </td>
              </tr>` : ''}
            `).join('')}
          </tbody>
        </table>
        ${posts.length > 5 ? `<button id="btn-perf-expand" style="display:flex;align-items:center;justify-content:center;gap:0.4rem;margin:0.75rem auto 0;padding:0.4rem 1rem;font-size:0.8rem;color:var(--primary-color);background:none;border:1px solid var(--border-color);border-radius:6px;cursor:pointer;transition:background 0.15s;">
          <i class="ph ph-caret-down"></i> Ver mais publicações
        </button>` : ''}
      </div>`}
    </div>

    <!-- AI Analysis Section -->
    <div class="card animate-up" id="ai-analysis-section">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem">
        <h3><i class="ph ph-sparkle" style="color:var(--primary-color)"></i> Análise Inteligente</h3>
        <button class="btn-secondary" id="btn-ai-analyze" style="font-size:0.8rem">
          <i class="ph ph-lightning"></i> Gerar Análise IA
        </button>
      </div>
      <div id="ai-analysis-content">
        <p style="color:var(--text-muted);font-size:0.9rem">Clique em "Gerar Análise IA" para obter insights personalizados sobre esta conta.</p>
      </div>
    </div>

    <!-- Content Type Breakdown + Topic Performance -->
    <div class="widgets-grid animate-up">
      <div class="card">
        <h3>Desempenho por Tipo</h3>
        ${typeBreakdown.length === 0
          ? '<p style="color:var(--text-muted);margin-top:1rem">Sem dados.</p>'
          : `<div style="position:relative;height:${Math.max(150, typeBreakdown.length * 50)}px;margin-top:1rem"><canvas id="type-chart"></canvas></div>`}
      </div>

      <div class="card">
        <h3>Desempenho por Tópico</h3>
        <div style="margin-top:0.75rem;display:flex;flex-wrap:wrap;gap:0.5rem;margin-bottom:1rem" id="tags-list">
          ${tagsData.map(t => `
            <span class="tag-pill" style="background:${escapeHTML(t.color)}20;color:${escapeHTML(t.color)};border:1px solid ${escapeHTML(t.color)}40">
              ${escapeHTML(t.tag_name)}
              <span class="tag-remove" data-tag-id="${t.id}" title="Remover tag">&times;</span>
            </span>
          `).join('')}
          <button class="btn-secondary" id="btn-add-tag" style="font-size:0.7rem;padding:0.2rem 0.5rem"><i class="ph ph-plus"></i> Nova Tag</button>
        </div>
        ${topicStats.length === 0
          ? '<p style="color:var(--text-muted);font-size:0.85rem">Atribua tags aos posts para ver o desempenho por topico.</p>'
          : `
          <div style="margin-top:0.5rem">
            ${topicStats.map(t => `
              <div style="display:flex;align-items:center;justify-content:space-between;padding:0.4rem 0;border-bottom:1px solid var(--border-color,rgba(0,0,0,0.06))">
                <div style="display:flex;align-items:center;gap:0.5rem">
                  <span style="width:10px;height:10px;border-radius:50%;background:${escapeHTML(t.color)}"></span>
                  <span style="font-size:0.85rem">${escapeHTML(t.tag_name)}</span>
                  <span style="font-size:0.7rem;color:var(--text-muted)">(${t.count} posts)</span>
                </div>
                <span class="badge ${t.avgEngagement >= 5 ? 'badge-success' : t.avgEngagement >= 2 ? 'badge-warning' : 'badge-neutral'}">${t.avgEngagement.toFixed(2)}%</span>
              </div>
            `).join('')}
          </div>`}
      </div>
    </div>

    <!-- Audience Demographics + Best Time -->
    <div class="widgets-grid animate-up" style="grid-template-columns:1fr 1fr">
      <div class="card">
        <h3>Demografia da Audiência</h3>
        ${!demographicsData
          ? '<p style="color:var(--text-muted);margin-top:1rem">Dados demográficos indisponíveis. A conta pode não ter seguidores suficientes ou a permissão instagram_manage_insights pode estar ausente.</p>'
          : `
          <div style="margin-top:1rem">
            <h4 style="font-size:0.85rem;margin-bottom:0.5rem">Gênero</h4>
            <div style="display:flex;gap:1rem;margin-bottom:1rem">
              <div style="flex:1;background:rgba(66,133,244,0.1);border-radius:8px;padding:0.5rem;text-align:center">
                <div style="font-size:1.2rem;font-weight:700;color:#4285f4">${demographicsData.gender_split.male}%</div>
                <div style="font-size:0.75rem;color:var(--text-muted)">Masculino</div>
              </div>
              <div style="flex:1;background:rgba(234,67,149,0.1);border-radius:8px;padding:0.5rem;text-align:center">
                <div style="font-size:1.2rem;font-weight:700;color:#ea4395">${demographicsData.gender_split.female}%</div>
                <div style="font-size:0.75rem;color:var(--text-muted)">Feminino</div>
              </div>
            </div>

            <h4 style="font-size:0.85rem;margin-bottom:0.5rem">Faixa Etária</h4>
            <div style="position:relative;height:200px;margin-bottom:1rem"><canvas id="age-chart"></canvas></div>

            <h4 style="font-size:0.85rem;margin-bottom:0.5rem">Principais Cidades</h4>
            ${demographicsData.cities.slice(0, 5).map((c, i) => `
              <div style="display:flex;align-items:center;justify-content:space-between;padding:0.3rem 0;font-size:0.85rem">
                <span>${i + 1}. ${escapeHTML(c.name)}</span>
                <span style="color:var(--text-muted)">${c.count.toLocaleString('pt-BR')}</span>
              </div>
            `).join('')}

            ${demographicsData.countries.length > 0 ? `
            <h4 style="font-size:0.85rem;margin:0.75rem 0 0.5rem">Principais Países</h4>
            ${demographicsData.countries.slice(0, 3).map((c, i) => `
              <div style="display:flex;align-items:center;justify-content:space-between;padding:0.3rem 0;font-size:0.85rem">
                <span>${i + 1}. ${escapeHTML(c.code)}</span>
                <span style="color:var(--text-muted)">${c.count.toLocaleString('pt-BR')}</span>
              </div>
            `).join('')}` : ''}

            ${renderDemographicCallout(demographicsData, cliente.especialidade)}
          </div>`}
      </div>

      <div class="card">
        <h3>Melhor Horário para Postar</h3>
        ${!bestTimesData || bestTimesData.totalPosts < 5
          ? '<p style="color:var(--text-muted);margin-top:1rem">Dados insuficientes. São necessários pelo menos 5 posts nos últimos 90 dias para análise.</p>'
          : `
          <p style="color:var(--text-muted);font-size:0.75rem;margin-top:0.25rem">Baseado no engajamento de ${bestTimesData.totalPosts} posts dos últimos 90 dias</p>
          <div style="margin-top:0.75rem;overflow-x:auto">
            ${renderBestTimesHeatmap(bestTimesData)}
            ${bestTimesData.topSlots.length > 0 ? `
            <div style="margin-top:1rem">
              <h4 style="font-size:0.85rem;margin-bottom:0.5rem">Top 3 Horários Recomendados</h4>
              ${bestTimesData.topSlots.map((s, i) => `
                <div style="display:flex;align-items:center;gap:0.5rem;padding:0.3rem 0;font-size:0.85rem">
                  <span class="badge badge-success">${i + 1}</span>
                  <span>${bestTimesData!.labels_days[s.day]} às ${bestTimesData!.labels_hours[s.hour]}</span>
                  <span style="color:var(--text-muted)">${s.value.toFixed(1)}% eng. (${s.postCount} post${s.postCount > 1 ? 's' : ''})</span>
                </div>
              `).join('')}
            </div>` : ''}
          </div>`}
      </div>
    </div>

    <!-- Reports Section -->
    ${reportsData.length > 0 ? `
    <div class="card animate-up" id="reports-section">
      <h3>Relatórios Gerados</h3>
      <div style="margin-top:1rem">
        ${reportsData.map(r => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid var(--border-color,rgba(0,0,0,0.06))">
            <div>
              <strong>${formatReportMonth(r.report_month)}</strong>
              <span style="font-size:0.75rem;color:var(--text-muted);margin-left:0.5rem">${new Date(r.generated_at).toLocaleDateString('pt-BR')}</span>
            </div>
            ${r.status === 'ready' && r.report_url
              ? `<a href="${sanitizeUrl(r.report_url)}" target="_blank" rel="noopener" class="btn-secondary" style="font-size:0.75rem"><i class="ph ph-download-simple"></i> Baixar PDF</a>`
              : `<span class="badge badge-warning">${r.status === 'generating' ? 'Gerando...' : r.status}</span>`}
          </div>
        `).join('')}
      </div>
    </div>` : ''}
    </div>
  `;

  // --- Bind Events ---

  // Back button
  document.getElementById('btn-back')?.addEventListener('click', () => navigate(`/cliente/${clientId}`));

  // Generate HTML report
  document.getElementById('btn-gen-report')?.addEventListener('click', () => {
    generateHtmlReport({
      clientName: cliente.nome,
      username: account.username,
      profilePicUrl: account.profile_picture_url,
      days: state.days,
      overview,
      posts,
      typeBreakdown,
      topicStats,
      demographicsData,
      bestTimesData,
      topSaved,
      especialidade: cliente.especialidade,
    });
    showToast('Relatório aberto em nova aba. Use "Salvar como PDF" para baixar.', 'success');
  });

  // AI Analysis button
  document.getElementById('btn-ai-analyze')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-ai-analyze') as HTMLButtonElement;
    const contentDiv = document.getElementById('ai-analysis-content')!;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analisando...';
    contentDiv.innerHTML = '<p style="color:var(--text-muted)"><i class="fa-solid fa-spinner fa-spin"></i> Gerando análise com IA... Isso pode levar alguns segundos.</p>';

    try {
      const result = await getAccountAIAnalysis(clientId, state.days);
      if (result.analysis.error) {
        contentDiv.innerHTML = `<p style="color:var(--danger)">Não foi possível gerar a análise. ${result.analysis.raw ? escapeHTML(String(result.analysis.raw).slice(0, 200)) : 'Tente novamente.'}</p>`;
        return;
      }
      const a = result.analysis;
      const scoreColor = a.healthScore >= 70 ? 'var(--success)' : a.healthScore >= 40 ? 'var(--warning)' : 'var(--danger)';

      contentDiv.innerHTML = `
        <div style="display:flex;align-items:center;gap:1.25rem;padding-bottom:1rem;border-bottom:1px solid var(--border-color)">
          <div style="font-size:2.8rem;font-weight:800;color:${scoreColor};line-height:1">${a.healthScore}</div>
          <div style="flex:1">
            <div style="font-size:0.75rem;text-transform:uppercase;font-weight:700;color:var(--text-muted);letter-spacing:0.5px;margin-bottom:0.2rem">Health Score</div>
            <p style="font-size:0.85rem;color:var(--text-main);line-height:1.4">${escapeHTML(a.healthExplanation)}</p>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1.25rem;padding:1.25rem 0;border-bottom:1px solid var(--border-color)">
          <div>
            <h4 style="font-size:0.8rem;margin-bottom:0.4rem;color:var(--text-muted)"><i class="ph ph-chart-bar" style="color:var(--primary-color)"></i> Performance de Conteúdo</h4>
            <p style="font-size:0.85rem;color:var(--text-main);line-height:1.5">${escapeHTML(a.contentInsights)}</p>
          </div>
          <div>
            <h4 style="font-size:0.8rem;margin-bottom:0.4rem;color:var(--text-muted)"><i class="ph ph-text-aa" style="color:var(--primary-color)"></i> Análise de Legendas</h4>
            <p style="font-size:0.85rem;color:var(--text-main);line-height:1.5">${escapeHTML(a.captionAnalysis)}</p>
          </div>
          <div>
            <h4 style="font-size:0.8rem;margin-bottom:0.4rem;color:var(--text-muted)"><i class="ph ph-trend-up" style="color:var(--primary-color)"></i> Projeção de Crescimento</h4>
            <p style="font-size:0.85rem;color:var(--text-main);line-height:1.5">${escapeHTML(a.growthForecast)}</p>
          </div>
        </div>
        <div style="padding-top:1.25rem">
          <h4 style="font-size:0.8rem;margin-bottom:0.6rem;color:var(--text-muted)"><i class="ph ph-target" style="color:var(--primary-color)"></i> Recomendações</h4>
          <div style="display:flex;flex-direction:column;gap:0.5rem">
            ${a.topRecommendations.map((r, i) => `
              <div style="display:flex;align-items:baseline;gap:0.6rem;font-size:0.85rem">
                <span class="badge badge-success" style="font-size:0.7rem;min-width:20px;text-align:center">${i + 1}</span>
                <span style="line-height:1.4">${escapeHTML(r)}</span>
              </div>
            `).join('')}
          </div>
        </div>
        <p style="font-size:0.65rem;color:var(--text-muted);margin-top:1rem;text-align:right">Gerado em ${new Date(result.generatedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</p>
      `;
    } catch (e: any) {
      contentDiv.innerHTML = `<p style="color:var(--danger)">Erro: ${escapeHTML(e.message || 'Falha na análise')}</p>`;
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="ph ph-lightning"></i> Gerar Análise IA';
    }
  });

  // Time range filter
  container.querySelectorAll('.filter-btn[data-days]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const newDays = parseInt((btn as HTMLElement).dataset.days || '30');
      state.days = newDays;
      destroyCharts();
      await renderContent(container, clientId, cliente, account, state);
    });
  });

  // Sort headers
  container.querySelectorAll('.sortable-header[data-col]').forEach(th => {
    th.addEventListener('click', async () => {
      const col = (th as HTMLElement).dataset.col || 'posted_at';
      if (state.sort.col === col) {
        state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sort.col = col;
        state.sort.dir = 'desc';
      }
      destroyCharts();
      await renderContent(container, clientId, cliente, account, state);
    });
  });

  // Expand/collapse performance table
  const perfExpandBtn = container.querySelector('#btn-perf-expand') as HTMLButtonElement | null;
  if (perfExpandBtn) {
    perfExpandBtn.addEventListener('click', () => {
      const hidden = container.querySelectorAll('.perf-row-hidden');
      const isExpanded = perfExpandBtn.dataset.expanded === '1';
      hidden.forEach(r => (r as HTMLElement).style.display = isExpanded ? 'none' : '');
      perfExpandBtn.dataset.expanded = isExpanded ? '0' : '1';
      const icon = perfExpandBtn.querySelector('i')!;
      const textNode = perfExpandBtn.childNodes[perfExpandBtn.childNodes.length - 1];
      if (isExpanded) {
        icon.className = 'ph ph-caret-down';
        textNode.textContent = ' Ver mais publicações';
      } else {
        icon.className = 'ph ph-caret-up';
        textNode.textContent = ' Ver menos';
      }
    });
  }

  // Expandable post rows
  container.querySelectorAll('.post-row').forEach(row => {
    row.addEventListener('click', async (e) => {
      if ((e.target as HTMLElement).closest('.btn-tag-add')) return;
      const postId = parseInt((row as HTMLElement).dataset.postId || '0');
      state.expandedPostId = state.expandedPostId === postId ? null : postId;
      destroyCharts();
      await renderContent(container, clientId, cliente, account, state);
    });
  });

  // Tag add buttons on posts
  container.querySelectorAll('.btn-tag-add').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const postId = parseInt((btn as HTMLElement).dataset.postId || '0');
      showTagAssignMenu(postId, btn as HTMLElement, tagsData, clientId, container, cliente, account, state);
    });
  });

  // Tag remove buttons
  container.querySelectorAll('.tag-remove').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const tagId = parseInt((btn as HTMLElement).dataset.tagId || '0');
      if (!confirm('Remover esta tag?')) return;
      try {
        await deleteTag(tagId);
        showToast('Tag removida', 'success');
        destroyCharts();
        await renderContent(container, clientId, cliente, account, state);
      } catch (err: any) {
        showToast(err.message || 'Erro ao remover tag', 'error');
      }
    });
  });

  // Add new tag
  document.getElementById('btn-add-tag')?.addEventListener('click', async () => {
    const name = prompt('Nome da nova tag (ex: Educativo, Procedimento, Bastidores):');
    if (!name || !name.trim()) return;
    const colors = ['#3ecf8e', '#f5a342', '#42c8f5', '#f542c8', '#eab308', '#f55a42', '#8b5cf6'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    try {
      await createTag(name.trim(), color);
      showToast('Tag criada!', 'success');
      destroyCharts();
      await renderContent(container, clientId, cliente, account, state);
    } catch (err: any) {
      showToast(err.message || 'Erro ao criar tag', 'error');
    }
  });

  // --- Render Charts ---
  if (history.length >= 2) {
    renderFollowerChart(history, postDates);
  }
  if (typeBreakdown.length > 0) {
    renderTypeChart(typeBreakdown);
  }
  if (demographicsData) {
    renderAgeChart(demographicsData);
  }
}

// --- Chart Renderers ---

function renderFollowerChart(history: any[], postDates: any[]) {
  const canvas = document.getElementById('follower-chart') as HTMLCanvasElement;
  if (!canvas) return;

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const textColor = isDark ? '#e0e0e0' : '#333';
  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  const postDateSet = new Set(postDates.map(p => p.date));

  const chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: history.map(h => new Date(h.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })),
      datasets: [
        {
          label: 'Seguidores',
          data: history.map(h => h.follower_count),
          borderColor: '#eab308',
          backgroundColor: 'rgba(234,179,8,0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: history.map(h => postDateSet.has(h.date) ? 6 : 2),
          pointBackgroundColor: history.map(h => postDateSet.has(h.date) ? '#f5a342' : '#eab308'),
          pointBorderColor: history.map(h => postDateSet.has(h.date) ? '#f5a342' : '#eab308'),
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            afterLabel: (ctx: any) => {
              const date = history[ctx.dataIndex]?.date;
              if (date && postDateSet.has(date)) {
                const count = postDates.filter(p => p.date === date).length;
                return `${count} post(s) publicado(s)`;
              }
              return '';
            },
          },
        },
      },
      scales: {
        x: { grid: { color: gridColor }, ticks: { color: textColor, maxTicksLimit: 10 } },
        y: { grid: { color: gridColor }, ticks: { color: textColor, precision: 0 } },
      },
    },
  });
  chartInstances.push(chart);
}

function renderTypeChart(typeBreakdown: { type: string; count: number; avgEngagement: number }[]) {
  const canvas = document.getElementById('type-chart') as HTMLCanvasElement;
  if (!canvas) return;

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const textColor = isDark ? '#e0e0e0' : '#333';
  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const colors = ['#eab308', '#42c8f5', '#f5a342', '#f542c8', '#3ecf8e'];

  const chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: typeBreakdown.map(t => `${t.type} (${t.count})`),
      datasets: [{
        label: 'Engajamento Médio',
        data: typeBreakdown.map(t => t.avgEngagement),
        backgroundColor: typeBreakdown.map((_, i) => colors[i % colors.length] + '99'),
        borderRadius: 4,
        barThickness: 28,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx: any) => `${ctx.parsed.x.toFixed(2)}%` } },
      },
      scales: {
        x: { grid: { color: gridColor }, ticks: { color: textColor, callback: (v: any) => v + '%' } },
        y: { grid: { display: false }, ticks: { color: textColor } },
      },
    },
  });
  chartInstances.push(chart);
}

function renderAgeChart(demographics: AudienceDemographics) {
  const canvas = document.getElementById('age-chart') as HTMLCanvasElement;
  if (!canvas) return;

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const textColor = isDark ? '#e0e0e0' : '#333';
  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  const chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: demographics.age_gender.map(a => a.age_range),
      datasets: [
        {
          label: 'Masculino',
          data: demographics.age_gender.map(a => a.male),
          backgroundColor: 'rgba(66,133,244,0.6)',
          borderRadius: 4,
        },
        {
          label: 'Feminino',
          data: demographics.age_gender.map(a => a.female),
          backgroundColor: 'rgba(234,67,149,0.6)',
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: textColor, boxWidth: 12 } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: textColor } },
        y: { grid: { color: gridColor }, ticks: { color: textColor } },
      },
    },
  });
  chartInstances.push(chart);
}

// --- Helpers ---

function renderKpiCard(label: string, value: string, delta: KpiDelta): string {
  const dirIcon = delta.direction === 'up' ? '↑' : delta.direction === 'down' ? '↓' : '→';
  const dirClass = delta.direction === 'up' ? 'analytics-delta-up' : delta.direction === 'down' ? 'analytics-delta-down' : 'analytics-delta-stable';
  const pct = Math.abs(delta.deltaPercent).toFixed(1);
  return `
    <div class="kpi-card">
      <span class="kpi-label">${label}</span>
      <span class="kpi-value" style="font-size:1.3rem">${value}</span>
      <span class="kpi-sub ${dirClass}">${dirIcon} ${pct}% vs periodo anterior</span>
    </div>`;
}

function formatDelta(d: KpiDelta): string {
  const sign = d.current >= 0 ? '+' : '';
  return sign + d.current.toLocaleString('pt-BR');
}

function formatMediaType(type: string): string {
  switch (type) {
    case 'VIDEO': return 'Reel';
    case 'CAROUSEL_ALBUM': return 'Carrossel';
    case 'IMAGE': return 'Imagem';
    case 'STORY': return 'Story';
    default: return type;
  }
}

function sortIcon(sort: { col: string; dir: string }, col: string): string {
  if (sort.col !== col) return '<i class="ph ph-arrows-down-up sort-icon" style="opacity:0.3"></i>';
  return sort.dir === 'asc'
    ? '<i class="ph ph-arrow-up sort-icon"></i>'
    : '<i class="ph ph-arrow-down sort-icon"></i>';
}

function formatReportMonth(month: string): string {
  const [y, m] = month.split('-');
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${months[parseInt(m) - 1]} ${y}`;
}

function renderBestTimesHeatmap(data: BestPostingTimes): string {
  const max = Math.max(...data.heatmap.flat(), 0.1);
  const hours = [0, 3, 6, 9, 12, 15, 18, 21];

  return `
    <table class="analytics-heatmap" style="width:100%;border-collapse:separate;border-spacing:3px">
      <thead>
        <tr>
          <th></th>
          ${hours.map(h => `<th style="font-size:0.65rem;color:var(--text-muted);font-weight:400">${h}h</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${data.labels_days.map((day, d) => `
          <tr>
            <td style="font-size:0.7rem;color:var(--text-muted);font-weight:500;text-align:right;padding-right:4px">${day}</td>
            ${hours.map(h => {
              const val = data.heatmap[d][h];
              const postCount = data.counts[d][h];
              const intensity = max > 0 ? val / max : 0;
              const isTop = data.topSlots.some(s => s.day === d && s.hour === h);
              const bg = intensity > 0
                ? `rgba(76,175,80,${0.1 + intensity * 0.8})`
                : 'rgba(0,0,0,0.02)';
              return `<td style="background:${bg};${isTop ? 'outline:2px solid var(--primary-color);outline-offset:-1px;' : ''}" title="${day} ${h}h: ${val.toFixed(1)}% eng. (${postCount} post${postCount !== 1 ? 's' : ''})">${val > 0 ? val.toFixed(1) + '%' : ''}</td>`;
            }).join('')}
          </tr>
        `).join('')}
      </tbody>
    </table>`;
}

// --- HTML Report Generator ---

interface HtmlReportData {
  clientName: string;
  username: string;
  profilePicUrl?: string;
  days: number;
  overview: any;
  posts: PostAnalytics[];
  typeBreakdown: { type: string; count: number; avgEngagement: number }[];
  topicStats: { tag_name: string; color: string; avgEngagement: number; count: number }[];
  demographicsData: AudienceDemographics | null;
  bestTimesData: BestPostingTimes | null;
  topSaved: PostAnalytics[];
  especialidade?: string;
}

function generateHtmlReport(data: HtmlReportData): void {
  const {
    clientName, username, days, overview, posts, typeBreakdown,
    topicStats, demographicsData, bestTimesData, topSaved, especialidade,
  } = data;

  const now = new Date();
  const dateStr = now.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

  // Mesaas logo SVG (desk/bureau icon from brand assets)
  const mesaasLogoSvg = `<svg width="200" height="67" viewBox="0 0 600 200" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="118.708" y="106.579" width="36.1281" height="14.8383" rx="3.22572" fill="#FF9E21"/>
    <rect x="164.514" y="106.579" width="36.1281" height="14.8383" rx="3.22572" fill="#FF9E21"/>
    <path d="M100 133.675V94.4551H218.823V133.675" stroke="#FF9E21" stroke-width="12.7829"/>
    <path d="M150.255 82.064H123.405C121.632 82.064 120.294 80.4592 120.621 78.7171C121.099 76.1686 121.732 72.8525 122.333 69.8442C123.266 65.1688 127.195 64 129.042 64H144.503C148.587 64 150.921 67.4534 151.504 69.8442C151.847 71.247 152.524 75.4027 153.052 78.8113C153.318 80.5245 151.989 82.064 150.255 82.064Z" fill="#FF9E21"/>
    <path d="M196.06 82.064H169.209C167.437 82.064 166.098 80.4592 166.425 78.7171C166.904 76.1686 167.537 72.8525 168.137 69.8442C169.071 65.1688 172.999 64 174.847 64H190.308C194.392 64 196.726 67.4534 197.309 69.8442C197.652 71.247 198.329 75.4027 198.857 78.8113C199.123 80.5245 197.794 82.064 196.06 82.064Z" fill="#FF9E21"/>
    <path d="M247.092 133.394V132.399L249.082 131.703C251.337 130.973 252.465 129.083 252.465 126.032V75.0891C252.465 73.7625 252.299 72.7012 251.967 71.9052C251.702 71.1092 250.939 70.4459 249.679 69.9153L247.092 68.7213V67.7263H266.295L284.702 115.883L302.014 67.7263H314.224V68.7213L312.632 69.3183C311.371 69.7826 310.509 70.4459 310.045 71.3082C309.58 72.1042 309.348 73.1655 309.348 74.4921V126.529C309.348 127.856 309.514 128.884 309.846 129.613C310.177 130.343 310.973 130.973 312.234 131.504L314.224 132.399V133.394H296.84V132.399L298.93 131.504C300.19 130.973 300.986 130.343 301.318 129.613C301.649 128.884 301.815 127.856 301.815 126.529V104.142L302.014 75.6861L281.219 133.394H276.244L254.554 76.3826L254.853 101.157V126.231C254.853 127.69 255.052 128.884 255.45 129.812C255.914 130.675 256.776 131.305 258.036 131.703L260.225 132.399V133.394H247.092Z" fill="#0A0B0E"/>
    <path d="M297.413 132.399V133.394H347.062L347.659 118.072H346.664L342.585 127.425C342.12 128.685 341.523 129.68 340.794 130.409C340.064 131.073 339.036 131.404 337.709 131.404H317.611V100.461H328.257C329.584 100.461 330.579 100.826 331.242 101.555C331.905 102.219 332.536 103.147 333.133 104.341L335.122 108.52H336.117V90.6106H335.122L333.133 94.5905C332.602 95.7845 331.972 96.7463 331.242 97.4759C330.579 98.1392 329.584 98.4709 328.257 98.4709H317.611V69.7163H335.52C336.847 69.7163 337.842 70.0811 338.505 70.8107C339.169 71.5404 339.799 72.5022 340.396 73.6961L344.674 83.0489H345.669L345.072 67.7263H302.686V126.529C302.686 127.856 302.454 128.917 301.99 129.713C301.592 130.443 300.829 131.04 299.702 131.504L297.413 132.399Z" fill="#0A0B0E"/>
    <path d="M372.2 135.185C368.552 135.185 364.838 134.721 361.057 133.792C357.276 132.93 354.125 131.769 351.604 130.31L352.102 116.778H353.097L356.181 123.246C357.11 125.103 358.105 126.761 359.166 128.22C360.228 129.613 361.687 130.708 363.544 131.504C364.871 132.167 366.131 132.631 367.325 132.897C368.585 133.096 369.978 133.195 371.504 133.195C375.55 133.195 378.734 132.101 381.056 129.912C383.444 127.723 384.637 124.904 384.637 121.455C384.637 118.204 383.842 115.684 382.25 113.893C380.658 112.036 378.104 110.245 374.588 108.52L370.509 106.729C364.804 104.208 360.327 101.323 357.077 98.0728C353.893 94.7563 352.301 90.3784 352.301 84.9392C352.301 81.0257 353.296 77.6428 355.286 74.7905C357.342 71.9383 360.161 69.7494 363.743 68.2237C367.391 66.6981 371.637 65.9353 376.479 65.9353C379.994 65.9353 383.311 66.3996 386.428 67.3283C389.612 68.2569 392.365 69.5172 394.687 71.1091L394.09 83.0488H393.095L389.015 75.5865C387.888 73.2649 386.76 71.6398 385.632 70.7112C384.505 69.7162 383.211 69.0197 381.752 68.6217C380.89 68.3564 380.094 68.1906 379.364 68.1242C378.635 67.9916 377.706 67.9252 376.578 67.9252C373.195 67.9252 370.343 68.9202 368.021 70.9102C365.7 72.8338 364.539 75.4539 364.539 78.7704C364.539 82.1533 365.435 84.8729 367.226 86.9292C369.016 88.9191 371.637 90.7101 375.086 92.302L379.663 94.292C386.03 97.0779 390.607 100.063 393.393 103.247C396.179 106.364 397.572 110.41 397.572 115.385C397.572 121.222 395.35 125.998 390.906 129.713C386.528 133.361 380.293 135.185 372.2 135.185Z" fill="#0A0B0E"/>
    <path d="M427.448 86.9431L419.951 108.452L410.377 78.9695L399.632 109.913H419.442L418.748 111.903H398.935L394.159 125.932C393.695 127.392 393.528 128.553 393.661 129.415C393.86 130.277 394.657 130.973 396.05 131.504L398.238 132.399V133.394H384.508V132.399L386.995 131.504C388.322 130.973 389.35 130.343 390.08 129.613C390.81 128.817 391.406 127.723 391.87 126.33L412.367 67.5271H420.824L427.448 86.9431ZM420.784 111.903L416.009 125.932C415.545 127.392 415.378 128.553 415.511 129.415C415.71 130.277 416.507 130.973 417.899 131.504L420.088 132.399V133.394H406.357V132.399L408.845 131.504C410.171 130.973 411.2 130.343 411.93 129.613C412.659 128.817 413.255 127.723 413.72 126.33L418.748 111.903H420.784ZM435.965 111.903L441.022 126.728C441.553 128.187 442.15 129.315 442.813 130.111C443.396 130.752 444.261 131.316 445.407 131.803C445.327 131.837 445.245 131.87 445.161 131.902L443.669 132.399V133.394H421.819V132.399L423.312 131.902C424.704 131.371 425.534 130.641 425.799 129.713C426.13 128.718 426.097 127.557 425.699 126.23L421.023 111.903H435.965ZM462.872 126.728C463.403 128.187 464 129.315 464.663 130.111C465.326 130.841 466.354 131.471 467.747 132.002L468.941 132.399V133.394H447.092V132.399L445.897 132.002C445.729 131.937 445.565 131.871 445.407 131.803C446.652 131.282 447.399 130.585 447.648 129.713C447.98 128.718 447.947 127.557 447.549 126.23L442.873 111.903H435.965L435.285 109.913H442.275L432.227 78.9695L428.443 89.8611L427.448 86.9431L434.217 67.5271H442.674L462.872 126.728ZM420.426 109.913H419.442L419.951 108.452L420.426 109.913ZM435.285 109.913H421.481L428.443 89.8611L435.285 109.913Z" fill="#FF9E21"/>
    <path d="M474.779 135.185C471.131 135.185 467.417 134.721 463.636 133.792C459.855 132.93 456.704 131.769 454.184 130.31L454.681 116.778H455.676L458.76 123.246C459.689 125.103 460.684 126.761 461.745 128.22C462.807 129.613 464.266 130.708 466.123 131.504C467.45 132.167 468.71 132.631 469.904 132.897C471.164 133.096 472.557 133.195 474.083 133.195C478.129 133.195 481.313 132.101 483.635 129.912C486.023 127.723 487.217 124.904 487.217 121.455C487.217 118.204 486.421 115.684 484.829 113.893C483.237 112.036 480.683 110.245 477.167 108.52L473.088 106.729C467.384 104.208 462.906 101.323 459.656 98.0728C456.472 94.7563 454.88 90.3784 454.88 84.9392C454.88 81.0257 455.875 77.6428 457.865 74.7905C459.921 71.9383 462.74 69.7494 466.322 68.2237C469.97 66.6981 474.216 65.9353 479.058 65.9353C482.573 65.9353 485.89 66.3996 489.008 67.3283C492.191 68.2569 494.944 69.5172 497.266 71.1091L496.669 83.0488H495.674L491.594 75.5865C490.467 73.2649 489.339 71.6398 488.212 70.7112C487.084 69.7162 485.79 69.0197 484.331 68.6217C483.469 68.3564 482.673 68.1906 481.943 68.1242C481.214 67.9916 480.285 67.9252 479.157 67.9252C475.774 67.9252 472.922 68.9202 470.601 70.9102C468.279 72.8338 467.118 75.4539 467.118 78.7704C467.118 82.1533 468.014 84.8729 469.805 86.9292C471.596 88.9191 474.216 90.7101 477.665 92.302L482.242 94.292C488.61 97.0779 493.186 100.063 495.972 103.247C498.758 106.364 500.151 110.41 500.151 115.385C500.151 121.222 497.929 125.998 493.485 129.713C489.107 133.361 482.872 135.185 474.779 135.185Z" fill="#0A0B0E"/>
  </svg>`;

  const truncText = (text: string, maxLen: number) =>
    text.length > maxLen ? text.slice(0, maxLen) + '...' : text;

  const fmtNum = (n: number) => n.toLocaleString('pt-BR');
  const fmtPct = (n: number) => n.toFixed(2) + '%';

  const deltaArrow = (d: KpiDelta) =>
    d.direction === 'up' ? '&#9650;' : d.direction === 'down' ? '&#9660;' : '&#9654;';
  const deltaColor = (d: KpiDelta) =>
    d.direction === 'up' ? '#22c55e' : d.direction === 'down' ? '#ef4444' : '#888';

  // Build demographics section
  let demographicsHtml = '';
  if (demographicsData) {
    const citiesHtml = demographicsData.cities.slice(0, 5).map((c, i) =>
      `<tr><td style="padding:4px 8px">${i + 1}. ${truncText(c.name, 30)}</td><td style="padding:4px 8px;text-align:right">${fmtNum(c.count)}</td></tr>`
    ).join('');

    const countriesHtml = demographicsData.countries.slice(0, 3).map((c, i) =>
      `<tr><td style="padding:4px 8px">${i + 1}. ${c.code}</td><td style="padding:4px 8px;text-align:right">${fmtNum(c.count)}</td></tr>`
    ).join('');

    const ageHtml = demographicsData.age_gender.map(a => `
      <tr>
        <td style="padding:4px 8px;font-size:12px">${a.age_range}</td>
        <td style="padding:4px 8px;text-align:right;color:#4285f4">${a.male}%</td>
        <td style="padding:4px 8px;text-align:right;color:#ea4395">${a.female}%</td>
      </tr>
    `).join('');

    demographicsHtml = `
      <div class="report-section">
        <h2>Demografia da Audiência</h2>
        <div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:16px">
          <div style="flex:1;min-width:120px;background:#f0f7ff;border-radius:8px;padding:16px;text-align:center">
            <div style="font-size:24px;font-weight:700;color:#4285f4">${demographicsData.gender_split.male}%</div>
            <div style="font-size:12px;color:#666">Masculino</div>
          </div>
          <div style="flex:1;min-width:120px;background:#fdf0f5;border-radius:8px;padding:16px;text-align:center">
            <div style="font-size:24px;font-weight:700;color:#ea4395">${demographicsData.gender_split.female}%</div>
            <div style="font-size:12px;color:#666">Feminino</div>
          </div>
        </div>

        <h3 style="font-size:13px;margin:16px 0 8px;color:#555">Faixa Etária</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="border-bottom:1px solid #e5e5e5">
            <th style="padding:4px 8px;text-align:left">Faixa</th>
            <th style="padding:4px 8px;text-align:right;color:#4285f4">Masc.</th>
            <th style="padding:4px 8px;text-align:right;color:#ea4395">Fem.</th>
          </tr></thead>
          <tbody>${ageHtml}</tbody>
        </table>

        <div style="display:flex;gap:24px;flex-wrap:wrap;margin-top:16px">
          <div style="flex:1;min-width:200px">
            <h3 style="font-size:13px;margin-bottom:8px;color:#555">Principais Cidades</h3>
            <table style="width:100%;border-collapse:collapse;font-size:13px"><tbody>${citiesHtml}</tbody></table>
          </div>
          ${demographicsData.countries.length > 0 ? `
          <div style="flex:1;min-width:200px">
            <h3 style="font-size:13px;margin-bottom:8px;color:#555">Principais Países</h3>
            <table style="width:100%;border-collapse:collapse;font-size:13px"><tbody>${countriesHtml}</tbody></table>
          </div>` : ''}
        </div>
      </div>`;
  }

  // Build best times heatmap
  let bestTimesHtml = '';
  if (bestTimesData && bestTimesData.totalPosts >= 5) {
    const hours = [0, 3, 6, 9, 12, 15, 18, 21];
    const max = Math.max(...bestTimesData.heatmap.flat(), 0.1);

    const heatmapRows = bestTimesData.labels_days.map((day, d) => {
      const cells = hours.map(h => {
        const val = bestTimesData.heatmap[d][h];
        const intensity = max > 0 ? val / max : 0;
        const isTop = bestTimesData.topSlots.some(s => s.day === d && s.hour === h);
        const bg = intensity > 0
          ? `rgba(76,175,80,${(0.15 + intensity * 0.7).toFixed(2)})`
          : '#f9f9f9';
        return `<td style="padding:4px 6px;text-align:center;font-size:11px;background:${bg};${isTop ? 'outline:2px solid #FF9E21;outline-offset:-1px;font-weight:700;' : ''}">${val > 0 ? val.toFixed(1) + '%' : ''}</td>`;
      }).join('');
      return `<tr><td style="padding:4px 8px;font-size:12px;font-weight:500;text-align:right;white-space:nowrap">${day}</td>${cells}</tr>`;
    }).join('');

    const topSlotsHtml = bestTimesData.topSlots.length > 0
      ? `<div style="margin-top:12px">${bestTimesData.topSlots.map((s, i) =>
          `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13px">
            <span style="background:#FF9E21;color:#fff;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700">${i + 1}</span>
            <span>${bestTimesData!.labels_days[s.day]} às ${bestTimesData!.labels_hours[s.hour]}</span>
            <span style="color:#888">${s.value.toFixed(1)}% eng. (${s.postCount} post${s.postCount > 1 ? 's' : ''})</span>
          </div>`
        ).join('')}</div>`
      : '';

    bestTimesHtml = `
      <div class="report-section">
        <h2>Melhor Horário para Postar</h2>
        <p style="font-size:12px;color:#888;margin-bottom:12px">Baseado no engajamento de ${bestTimesData.totalPosts} posts dos últimos 90 dias</p>
        <table style="width:100%;border-collapse:separate;border-spacing:3px">
          <thead><tr>
            <th></th>
            ${hours.map(h => `<th style="font-size:11px;color:#888;font-weight:400">${h}h</th>`).join('')}
          </tr></thead>
          <tbody>${heatmapRows}</tbody>
        </table>
        ${topSlotsHtml}
      </div>`;
  }

  // Content type breakdown
  let typeBreakdownHtml = '';
  if (typeBreakdown.length > 0) {
    const colors = ['#FF9E21', '#42c8f5', '#f5a342', '#f542c8', '#3ecf8e'];
    typeBreakdownHtml = `
      <div class="report-section">
        <h2>Desempenho por Tipo de Conteúdo</h2>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="border-bottom:2px solid #e5e5e5">
            <th style="padding:8px;text-align:left">Tipo</th>
            <th style="padding:8px;text-align:center">Quantidade</th>
            <th style="padding:8px;text-align:right">Engajamento Médio</th>
          </tr></thead>
          <tbody>
            ${typeBreakdown.map((t, i) => `
              <tr style="border-bottom:1px solid #f0f0f0">
                <td style="padding:8px"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${colors[i % colors.length]};margin-right:8px;vertical-align:middle"></span>${t.type}</td>
                <td style="padding:8px;text-align:center">${t.count}</td>
                <td style="padding:8px;text-align:right;font-weight:600">${t.avgEngagement.toFixed(2)}%</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;
  }

  // Topic performance
  let topicHtml = '';
  if (topicStats.length > 0) {
    topicHtml = `
      <div class="report-section">
        <h2>Desempenho por Tópico</h2>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="border-bottom:2px solid #e5e5e5">
            <th style="padding:8px;text-align:left">Tópico</th>
            <th style="padding:8px;text-align:center">Posts</th>
            <th style="padding:8px;text-align:right">Engajamento Médio</th>
          </tr></thead>
          <tbody>
            ${topicStats.map(t => `
              <tr style="border-bottom:1px solid #f0f0f0">
                <td style="padding:8px"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${t.color};margin-right:8px;vertical-align:middle"></span>${t.tag_name}</td>
                <td style="padding:8px;text-align:center">${t.count}</td>
                <td style="padding:8px;text-align:right;font-weight:600">${t.avgEngagement.toFixed(2)}%</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;
  }

  // Top saved posts
  let topSavedHtml = '';
  if (topSaved.length > 0) {
    topSavedHtml = `
      <div class="report-section">
        <h2>Posts Mais Salvos</h2>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="border-bottom:2px solid #e5e5e5">
            <th style="padding:8px;text-align:left">Post</th>
            <th style="padding:8px;text-align:center">Salvamentos</th>
            <th style="padding:8px;text-align:right">Taxa</th>
          </tr></thead>
          <tbody>
            ${topSaved.map(p => `
              <tr style="border-bottom:1px solid #f0f0f0">
                <td style="padding:8px;max-width:350px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${truncText(p.caption || 'Sem legenda', 70)}</td>
                <td style="padding:8px;text-align:center;font-weight:600">${p.saved}</td>
                <td style="padding:8px;text-align:right">${p.saves_rate.toFixed(1)}%</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;
  }

  // Posts performance table (top 15)
  const displayPosts = posts.slice(0, 15);
  const postsHtml = displayPosts.length > 0 ? `
    <div class="report-section">
      <h2>Performance de Conteúdo</h2>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="border-bottom:2px solid #e5e5e5">
          <th style="padding:8px;text-align:left">Data</th>
          <th style="padding:8px;text-align:left">Tipo</th>
          <th style="padding:8px;text-align:right">Alcance</th>
          <th style="padding:8px;text-align:right">Engaj.</th>
          <th style="padding:8px;text-align:right">Salvos</th>
          <th style="padding:8px;text-align:right">Coment.</th>
          <th style="padding:8px;text-align:right">Compart.</th>
        </tr></thead>
        <tbody>
          ${displayPosts.map(p => `
            <tr style="border-bottom:1px solid #f0f0f0">
              <td style="padding:6px 8px">${new Date(p.posted_at).toLocaleDateString('pt-BR')}</td>
              <td style="padding:6px 8px">${formatMediaType(p.media_type)}</td>
              <td style="padding:6px 8px;text-align:right">${fmtNum(p.reach)}</td>
              <td style="padding:6px 8px;text-align:right;font-weight:600;color:${p.engagement_rate >= 5 ? '#22c55e' : p.engagement_rate >= 2 ? '#eab308' : '#888'}">${p.engagement_rate.toFixed(1)}%</td>
              <td style="padding:6px 8px;text-align:right">${p.saved}</td>
              <td style="padding:6px 8px;text-align:right">${p.comments}</td>
              <td style="padding:6px 8px;text-align:right">${p.shares}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      ${posts.length > 15 ? `<p style="font-size:11px;color:#888;margin-top:8px;text-align:right">Exibindo 15 de ${posts.length} publicações</p>` : ''}
    </div>` : '';

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Relatório - ${clientName} (@${username})</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #1a1a1a;
      background: #fff;
      line-height: 1.5;
    }

    /* Cover */
    .cover {
      background: linear-gradient(135deg, #0A0B0E 0%, #1a1b20 100%);
      color: #fff;
      padding: 60px 48px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      min-height: 260px;
    }
    .cover-logo { margin-bottom: 32px; }
    .cover h1 {
      font-size: 32px;
      font-weight: 800;
      margin-bottom: 4px;
      letter-spacing: -0.5px;
    }
    .cover .cover-username {
      font-size: 16px;
      color: #FF9E21;
      font-weight: 500;
      margin-bottom: 16px;
    }
    .cover .cover-meta {
      font-size: 13px;
      color: rgba(255,255,255,0.5);
    }

    /* Content header strip */
    .content-header-strip {
      background: #FF9E21;
      height: 5px;
    }

    /* Main content */
    .content {
      max-width: 800px;
      margin: 0 auto;
      padding: 32px 48px;
    }

    /* KPIs */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      margin-bottom: 32px;
    }
    .kpi-box {
      border: 1px solid #e5e5e5;
      border-radius: 10px;
      padding: 16px;
      text-align: center;
    }
    .kpi-box .kpi-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #888;
      font-weight: 600;
      margin-bottom: 6px;
    }
    .kpi-box .kpi-value {
      font-size: 22px;
      font-weight: 800;
      color: #1a1a1a;
    }
    .kpi-box .kpi-delta {
      font-size: 12px;
      margin-top: 4px;
    }

    /* Sections */
    .report-section {
      margin-bottom: 32px;
      page-break-inside: avoid;
    }
    .report-section h2 {
      font-size: 16px;
      font-weight: 700;
      color: #1a1a1a;
      padding-bottom: 8px;
      border-bottom: 2px solid #FF9E21;
      margin-bottom: 16px;
    }
    .report-section h3 {
      font-size: 13px;
      color: #555;
    }

    /* Footer */
    .report-footer {
      text-align: center;
      padding: 24px 48px;
      border-top: 1px solid #e5e5e5;
      font-size: 11px;
      color: #aaa;
    }

    /* Print toolbar */
    .print-toolbar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      background: #0A0B0E;
      color: #fff;
      padding: 12px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      z-index: 1000;
      box-shadow: 0 2px 12px rgba(0,0,0,0.3);
    }
    .print-toolbar button {
      background: #FF9E21;
      color: #fff;
      border: none;
      padding: 8px 24px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }
    .print-toolbar button:hover { background: #e8900a; }

    @media print {
      .print-toolbar { display: none !important; }
      body { padding-top: 0 !important; }
      .cover { page-break-after: avoid; }
      .report-section { page-break-inside: avoid; }
    }

    @media screen {
      body { padding-top: 56px; }
    }
  </style>
</head>
<body>
  <div class="print-toolbar">
    <span style="font-size:13px">Relatório de <strong>${truncText(clientName, 30)}</strong></span>
    <button onclick="window.print()">Salvar como PDF</button>
  </div>

  <!-- Cover -->
  <div class="cover">
    <div class="cover-logo">${mesaasLogoSvg}</div>
    <h1>${truncText(clientName, 40)}</h1>
    <div class="cover-username">@${truncText(username, 30)}</div>
    <div class="cover-meta">Relatório de Performance · Últimos ${days} dias · Gerado em ${dateStr}</div>
  </div>

  <!-- Accent strip -->
  <div class="content-header-strip"></div>

  <!-- Content -->
  <div class="content">
    <!-- KPI Cards -->
    <div class="kpi-grid">
      <div class="kpi-box">
        <div class="kpi-label">Seguidores</div>
        <div class="kpi-value">${fmtNum(overview.followerCount)}</div>
        <div class="kpi-delta" style="color:${deltaColor(overview.followers)}">${deltaArrow(overview.followers)} ${Math.abs(overview.followers.deltaPercent).toFixed(1)}%</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">Engajamento</div>
        <div class="kpi-value">${fmtPct(overview.engagement.current)}</div>
        <div class="kpi-delta" style="color:${deltaColor(overview.engagement)}">${deltaArrow(overview.engagement)} ${Math.abs(overview.engagement.deltaPercent).toFixed(1)}%</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">Alcance</div>
        <div class="kpi-value">${fmtNum(overview.reach.current)}</div>
        <div class="kpi-delta" style="color:${deltaColor(overview.reach)}">${deltaArrow(overview.reach)} ${Math.abs(overview.reach.deltaPercent).toFixed(1)}%</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">Contas Engajadas</div>
        <div class="kpi-value">${fmtNum(overview.profileViews.current)}</div>
        <div class="kpi-delta" style="color:${deltaColor(overview.profileViews)}">${deltaArrow(overview.profileViews)} ${Math.abs(overview.profileViews.deltaPercent).toFixed(1)}%</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">Cliques no Link</div>
        <div class="kpi-value">${fmtNum(overview.websiteClicks.current)}</div>
        <div class="kpi-delta" style="color:${deltaColor(overview.websiteClicks)}">${deltaArrow(overview.websiteClicks)} ${Math.abs(overview.websiteClicks.deltaPercent).toFixed(1)}%</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">Taxa de Salvamentos</div>
        <div class="kpi-value">${fmtPct(overview.savesRate.current)}</div>
        <div class="kpi-delta" style="color:${deltaColor(overview.savesRate)}">${deltaArrow(overview.savesRate)} ${Math.abs(overview.savesRate.deltaPercent).toFixed(1)}%</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">Posts Publicados</div>
        <div class="kpi-value">${overview.postsPublished.current}</div>
        <div class="kpi-delta" style="color:${deltaColor(overview.postsPublished)}">${deltaArrow(overview.postsPublished)} ${Math.abs(overview.postsPublished.deltaPercent).toFixed(1)}%</div>
      </div>
    </div>

    ${topSavedHtml}
    ${postsHtml}
    ${typeBreakdownHtml}
    ${topicHtml}
    ${demographicsHtml}
    ${bestTimesHtml}
  </div>

  <div class="report-footer">
    Mesaas · Plataforma Inteligente · ${dateStr}
  </div>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) {
    // Fallback: download as file
    const a = document.createElement('a');
    a.href = url;
    a.download = `relatorio-${username}-${now.toISOString().slice(0, 10)}.html`;
    a.click();
  }
  // Clean up object URL after a delay
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function renderDemographicCallout(data: AudienceDemographics, especialidade?: string): string {
  if (!especialidade) return '';

  const spec = especialidade.toLowerCase();
  const totalNonBR = data.countries.filter(c => c.code !== 'BR').reduce((s, c) => s + c.count, 0);
  const totalAll = data.countries.reduce((s, c) => s + c.count, 0);
  const foreignPct = totalAll > 0 ? (totalNonBR / totalAll) * 100 : 0;

  const messages: string[] = [];

  // Age analysis
  const dominant = data.age_gender.reduce((max, a) =>
    (a.male + a.female) > (max.male + max.female) ? a : max
  , data.age_gender[0]);

  if (dominant) {
    const parentSpecialties = ['pediatr', 'neonat'];
    const isParentSpec = parentSpecialties.some(s => spec.includes(s));
    if (isParentSpec && dominant.age_range === '25-34') {
      messages.push(`<span style="color:var(--success)"><i class="ph ph-check-circle"></i> Audiência alinhada: a faixa ${dominant.age_range} são tipicamente pais jovens, ideal para ${escapeHTML(especialidade)}.</span>`);
    }
  }

  if (foreignPct > 50) {
    messages.push(`<span style="color:var(--warning)"><i class="ph ph-warning"></i> ${Math.round(foreignPct)}% da audiência está fora do Brasil. Considere revisar a estratégia de conteúdo para atrair público local.</span>`);
  }

  if (messages.length === 0) return '';

  return `
    <div class="analytics-callout" style="margin-top:1rem">
      <strong style="font-size:0.8rem">Análise de Audiência</strong>
      ${messages.map(m => `<p style="font-size:0.8rem;margin-top:0.25rem">${m}</p>`).join('')}
    </div>`;
}

function showTagAssignMenu(postId: number, anchor: HTMLElement, tags: PostTag[], clientId: number, container: HTMLElement, cliente: any, account: any, state: State) {
  // Remove any existing menu
  document.querySelectorAll('.tag-assign-menu').forEach(m => m.remove());

  if (tags.length === 0) {
    showToast('Crie tags primeiro usando o botao "Nova Tag"', 'info');
    return;
  }

  const menu = document.createElement('div');
  menu.className = 'tag-assign-menu';
  menu.style.cssText = 'position:absolute;z-index:100;background:var(--card-bg);border:1px solid var(--border-color,rgba(0,0,0,0.1));border-radius:8px;padding:0.5rem;box-shadow:0 4px 12px rgba(0,0,0,0.15);min-width:150px';
  menu.innerHTML = tags.map(t =>
    `<div class="tag-assign-option" data-tag-id="${t.id}" style="display:flex;align-items:center;gap:0.5rem;padding:0.35rem 0.5rem;cursor:pointer;border-radius:4px;font-size:0.8rem">
      <span style="width:10px;height:10px;border-radius:50%;background:${escapeHTML(t.color)}"></span>
      ${escapeHTML(t.tag_name)}
    </div>`
  ).join('');

  anchor.style.position = 'relative';
  anchor.appendChild(menu);

  menu.querySelectorAll('.tag-assign-option').forEach(opt => {
    opt.addEventListener('click', async (e) => {
      e.stopPropagation();
      const tagId = parseInt((opt as HTMLElement).dataset.tagId || '0');
      try {
        await assignTagToPost(postId, tagId);
        showToast('Tag atribuida!', 'success');
        menu.remove();
        destroyCharts();
        await renderContent(container, clientId, cliente, account, state);
      } catch (err: any) {
        showToast(err.message || 'Erro', 'error');
      }
    });

    opt.addEventListener('mouseenter', () => {
      (opt as HTMLElement).style.background = 'var(--hover-bg, rgba(0,0,0,0.05))';
    });
    opt.addEventListener('mouseleave', () => {
      (opt as HTMLElement).style.background = '';
    });
  });

  // Close menu on outside click
  const closeHandler = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) {
      menu.remove();
      document.removeEventListener('click', closeHandler);
    }
  };
  setTimeout(() => document.addEventListener('click', closeHandler), 0);
}
