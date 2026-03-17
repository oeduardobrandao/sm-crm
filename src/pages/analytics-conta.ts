// =============================================
// Pagina: Analytics - Conta Individual
// =============================================
import { escapeHTML, sanitizeUrl, showToast, navigate, openModal } from '../router';
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
  upsertManualFollowerCount,
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
  overviewDays: number;
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

    const state: State = { days: 30, overviewDays: 30, sort: { col: 'posted_at', dir: 'desc' }, expandedPostId: null };
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
    getAnalyticsOverview(clientId, state.overviewDays),
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
      <button class="filter-btn ${state.overviewDays === 7 ? 'active' : ''}" data-days="7">7 dias</button>
      <button class="filter-btn ${state.overviewDays === 30 ? 'active' : ''}" data-days="30">30 dias</button>
      <button class="filter-btn ${state.overviewDays === 90 ? 'active' : ''}" data-days="90">90 dias</button>
      <span style="color:var(--text-muted);align-self:center;font-size:0.75rem">ou</span>
      <input type="number" id="custom-days-input" class="filter-btn" min="1" max="730" placeholder="Dias..."
             value="${![7, 30, 90].includes(state.overviewDays) ? state.overviewDays : ''}"
             style="width:80px">
    </div>

    <!-- KPI Cards -->
    <div class="kpi-grid animate-up" style="grid-template-columns:repeat(auto-fit, minmax(160px, 1fr))">
      ${renderKpiCard('SEGUIDORES', overview.followerCount.toLocaleString('pt-BR'), overview.followers, `${state.overviewDays}d`)}
      ${renderKpiCard('ENGAJAMENTO', overview.engagement.current.toFixed(2) + '%', overview.engagement, `${state.overviewDays}d`)}
      ${renderKpiCard('ALCANCE', overview.reach.current.toLocaleString('pt-BR'), overview.reach, `${state.overviewDays}d`)}
      ${renderKpiCard('CONTAS ENGAJADAS', overview.profileViews.current.toLocaleString('pt-BR'), overview.profileViews, '28d fixo')}
      ${renderKpiCard('CLIQUES NO LINK', overview.websiteClicks.current.toLocaleString('pt-BR'), overview.websiteClicks, '28d fixo')}
      ${renderKpiCard('TAXA DE SALVAMENTOS', overview.savesRate.current.toFixed(2) + '%', overview.savesRate, `${state.overviewDays}d`)}
      ${renderKpiCard('POSTS PUBLICADOS', String(overview.postsPublished.current), overview.postsPublished, `${state.overviewDays}d`)}
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
      <div style="display:flex;align-items:center;justify-content:space-between">
        <h3>Crescimento de Seguidores</h3>
        <button class="btn-secondary" id="btn-manual-follower" style="font-size:0.75rem;padding:4px 10px">
          <i class="ph ph-pencil-simple"></i> Inserir manualmente
        </button>
      </div>
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
      overviewDays: state.overviewDays,
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

  // Time range filter — presets update both days and overviewDays
  container.querySelectorAll('.filter-btn[data-days]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const newDays = parseInt((btn as HTMLElement).dataset.days || '30');
      state.days = newDays;
      state.overviewDays = newDays;
      destroyCharts();
      await renderContent(container, clientId, cliente, account, state);
    });
  });

  // Custom days input — updates only overviewDays (KPI cards)
  const customDaysInput = container.querySelector('#custom-days-input') as HTMLInputElement | null;
  if (customDaysInput) {
    customDaysInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        const val = parseInt(customDaysInput.value, 10);
        if (isNaN(val) || val < 1 || val > 730) {
          showToast('Insira um valor entre 1 e 730 dias', 'error');
          return;
        }
        state.overviewDays = val;
        destroyCharts();
        await renderContent(container, clientId, cliente, account, state);
      }
    });
  }

  // Manual follower entry
  document.getElementById('btn-manual-follower')?.addEventListener('click', () => {
    const today = new Date().toISOString().split('T')[0];
    openModal('Inserir Seguidores Manualmente', `
      <div style="display:flex;flex-direction:column;gap:1rem">
        <p style="font-size:0.85rem;color:var(--text-muted)">
          Insira a contagem de seguidores para uma data específica. Dados manuais não serão sobrescritos pela sincronização automática.
        </p>
        <label style="font-size:0.85rem">
          Data
          <input type="date" name="date" value="${today}" max="${today}"
                 style="width:100%;padding:0.5rem;border:1px solid var(--border-color);border-radius:6px;margin-top:0.25rem;background:var(--card-bg);color:var(--text-main)">
        </label>
        <label style="font-size:0.85rem">
          Número de seguidores
          <input type="number" name="follower_count" min="0" placeholder="Ex: 15432"
                 style="width:100%;padding:0.5rem;border:1px solid var(--border-color);border-radius:6px;margin-top:0.25rem;background:var(--card-bg);color:var(--text-main)">
        </label>
      </div>
    `, async (form) => {
      const date = (form.querySelector('[name="date"]') as HTMLInputElement).value;
      const count = parseInt((form.querySelector('[name="follower_count"]') as HTMLInputElement).value, 10);
      if (!date || isNaN(count) || count < 0) {
        showToast('Preencha todos os campos corretamente', 'error');
        return;
      }
      try {
        await upsertManualFollowerCount(clientId, date, count);
        showToast('Seguidores registrados com sucesso', 'success');
        destroyCharts();
        await renderContent(container, clientId, cliente, account, state);
      } catch (err: any) {
        showToast(err.message || 'Erro ao salvar', 'error');
      }
    }, { submitText: 'Salvar' });
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
          pointRadius: history.map(h => h.source === 'manual' ? 5 : postDateSet.has(h.date) ? 6 : 2),
          pointStyle: history.map(h => h.source === 'manual' ? 'rectRot' : 'circle'),
          pointBackgroundColor: history.map(h => h.source === 'manual' ? '#8b5cf6' : postDateSet.has(h.date) ? '#f5a342' : '#eab308'),
          pointBorderColor: history.map(h => h.source === 'manual' ? '#8b5cf6' : postDateSet.has(h.date) ? '#f5a342' : '#eab308'),
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
              const entry = history[ctx.dataIndex];
              const lines: string[] = [];
              if (entry?.source === 'manual') lines.push('Inserido manualmente');
              if (entry?.date && postDateSet.has(entry.date)) {
                const count = postDates.filter(p => p.date === entry.date).length;
                lines.push(`${count} post(s) publicado(s)`);
              }
              return lines.join('\n');
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

function renderKpiCard(label: string, value: string, delta: KpiDelta, period?: string): string {
  const dirIcon = delta.direction === 'up' ? '↑' : delta.direction === 'down' ? '↓' : '→';
  const dirClass = delta.direction === 'up' ? 'analytics-delta-up' : delta.direction === 'down' ? 'analytics-delta-down' : 'analytics-delta-stable';
  const pct = Math.abs(delta.deltaPercent).toFixed(1);
  const periodBadge = period
    ? `<span style="display:inline-block;align-self:flex-start;margin-top:4px;font-size:0.72rem;padding:2px 7px;border-radius:4px;background:var(--border-color,rgba(0,0,0,0.08));color:var(--text-muted)">${period}</span>`
    : '';
  return `
    <div class="kpi-card">
      <span class="kpi-label">${label}</span>
      <span class="kpi-value" style="font-size:1.3rem">${value}</span>
      <span class="kpi-sub ${dirClass}">${dirIcon} ${pct}% vs periodo anterior</span>
      ${periodBadge}
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
  overviewDays: number;
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
    clientName, username, overviewDays, overview, posts, typeBreakdown,
    topicStats, demographicsData, bestTimesData, topSaved, especialidade,
  } = data;

  const now = new Date();
  const dateStr = now.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

  // Mesaas logo SVG (desk/bureau icon from brand assets)
  const mesaasLogoSvg = `<svg width="200" height="67" viewBox="0 0 600 200" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M272.2 72.1852C268.552 72.1852 264.838 71.7209 261.057 70.7923C257.276 69.93 254.125 68.7692 251.604 67.3099L252.102 53.7783H253.097L256.181 60.2456C257.11 62.1029 258.105 63.7612 259.166 65.2205C260.228 66.6134 261.687 67.7079 263.544 68.5038C264.871 69.1672 266.131 69.6315 267.325 69.8968C268.585 70.0958 269.978 70.1953 271.504 70.1953C275.55 70.1953 278.734 69.1008 281.056 66.9119C283.444 64.723 284.637 61.9039 284.637 58.4546C284.637 55.2044 283.842 52.6838 282.25 50.8929C280.658 49.0356 278.104 47.2446 274.588 45.52L270.509 43.7291C264.804 41.2085 260.327 38.3231 257.077 35.0728C253.893 31.7563 252.301 27.3784 252.301 21.9392C252.301 18.0257 253.296 14.6428 255.286 11.7905C257.342 8.93829 260.161 6.74936 263.743 5.22374C267.391 3.69811 271.637 2.9353 276.479 2.9353C279.994 2.9353 283.311 3.39962 286.428 4.32826C289.612 5.2569 292.365 6.5172 294.687 8.10915L294.09 20.0488H293.095L289.015 12.5865C287.888 10.2649 286.76 8.6398 285.632 7.71116C284.505 6.71619 283.211 6.01971 281.752 5.62172C280.89 5.3564 280.094 5.19057 279.364 5.12424C278.635 4.99158 277.706 4.92524 276.578 4.92524C273.195 4.92524 270.343 5.92021 268.021 7.91016C265.7 9.83376 264.539 12.4539 264.539 15.7704C264.539 19.1533 265.435 21.8729 267.226 23.9292C269.016 25.9191 271.637 27.7101 275.086 29.302L279.663 31.292C286.03 34.0779 290.607 37.0628 293.393 40.2467C296.179 43.3643 297.572 47.4105 297.572 52.3853C297.572 58.2225 295.35 62.9984 290.906 66.7129C286.528 70.3611 280.293 72.1852 272.2 72.1852Z" fill="#E9EAF2"/>
<path d="M327.448 23.9431L319.951 45.4519L310.377 15.9695L299.632 46.9128H319.442L318.748 48.9031H298.935L294.159 62.9324C293.695 64.3916 293.528 65.5525 293.661 66.4148C293.86 67.277 294.657 67.973 296.05 68.5037L298.238 69.3992V70.3943H284.508V69.3992L286.995 68.5037C288.322 67.973 289.35 67.3427 290.08 66.613C290.81 65.8171 291.406 64.7225 291.87 63.3298L312.367 4.5271H320.824L327.448 23.9431ZM320.784 48.9031L316.009 62.9324C315.545 64.3916 315.378 65.5525 315.511 66.4148C315.71 67.277 316.507 67.973 317.899 68.5037L320.088 69.3992V70.3943H306.357V69.3992L308.845 68.5037C310.171 67.973 311.2 67.3427 311.93 66.613C312.659 65.8171 313.255 64.7225 313.72 63.3298L318.748 48.9031H320.784ZM335.965 48.9031L341.022 63.7283C341.553 65.1874 342.15 66.3152 342.813 67.1111C343.396 67.7522 344.261 68.316 345.407 68.8035C345.327 68.8369 345.245 68.8701 345.161 68.9021L343.669 69.3992V70.3943H321.819V69.3992L323.312 68.9021C324.704 68.3714 325.534 67.6413 325.799 66.7126C326.13 65.7177 326.097 64.5567 325.699 63.2302L321.023 48.9031H335.965ZM362.872 63.7283C363.403 65.1874 364 66.3152 364.663 67.1111C365.326 67.8406 366.354 68.4711 367.747 69.0017L368.941 69.3992V70.3943H347.092V69.3992L345.897 69.0017C345.729 68.9374 345.565 68.8707 345.407 68.8035C346.652 68.2823 347.399 67.5852 347.648 66.7126C347.98 65.7177 347.947 64.5567 347.549 63.2302L342.873 48.9031H335.965L335.285 46.9128H342.275L332.227 15.9695L328.443 26.8611L327.448 23.9431L334.217 4.5271H342.674L362.872 63.7283ZM320.426 46.9128H319.442L319.951 45.4519L320.426 46.9128ZM335.285 46.9128H321.481L328.443 26.8611L335.285 46.9128Z" fill="#FF9E21"/>
<path d="M374.779 72.1852C371.131 72.1852 367.417 71.7209 363.636 70.7923C359.855 69.93 356.704 68.7692 354.184 67.3099L354.681 53.7783H355.676L358.76 60.2456C359.689 62.1029 360.684 63.7612 361.745 65.2205C362.807 66.6134 364.266 67.7079 366.123 68.5038C367.45 69.1672 368.71 69.6315 369.904 69.8968C371.164 70.0958 372.557 70.1953 374.083 70.1953C378.129 70.1953 381.313 69.1008 383.635 66.9119C386.023 64.723 387.217 61.9039 387.217 58.4546C387.217 55.2044 386.421 52.6838 384.829 50.8929C383.237 49.0356 380.683 47.2446 377.167 45.52L373.088 43.7291C367.384 41.2085 362.906 38.3231 359.656 35.0728C356.472 31.7563 354.88 27.3784 354.88 21.9392C354.88 18.0257 355.875 14.6428 357.865 11.7905C359.921 8.93829 362.74 6.74936 366.322 5.22374C369.97 3.69811 374.216 2.9353 379.058 2.9353C382.573 2.9353 385.89 3.39962 389.008 4.32826C392.191 5.2569 394.944 6.5172 397.266 8.10915L396.669 20.0488H395.674L391.594 12.5865C390.467 10.2649 389.339 8.6398 388.212 7.71116C387.084 6.71619 385.79 6.01971 384.331 5.62172C383.469 5.3564 382.673 5.19057 381.943 5.12424C381.214 4.99158 380.285 4.92524 379.157 4.92524C375.774 4.92524 372.922 5.92021 370.601 7.91016C368.279 9.83376 367.118 12.4539 367.118 15.7704C367.118 19.1533 368.014 21.8729 369.805 23.9292C371.596 25.9191 374.216 27.7101 377.665 29.302L382.242 31.292C388.61 34.0779 393.186 37.0628 395.972 40.2467C398.758 43.3643 400.151 47.4105 400.151 52.3853C400.151 58.2225 397.929 62.9984 393.485 66.7129C389.107 70.3611 382.872 72.1852 374.779 72.1852Z" fill="#E9EAF2"/>
<path d="M197.413 69.3994V70.3944H247.062L247.659 55.0718H246.664L242.585 64.4245C242.12 65.6848 241.523 66.6798 240.794 67.4094C240.064 68.0728 239.036 68.4044 237.709 68.4044H217.611V37.4608H228.257C229.584 37.4608 230.579 37.8257 231.242 38.5553C231.905 39.2186 232.536 40.1473 233.133 41.3412L235.122 45.5201H236.117V27.6106H235.122L233.133 31.5905C232.602 32.7845 231.972 33.7463 231.242 34.4759C230.579 35.1392 229.584 35.4709 228.257 35.4709H217.611V6.71626H235.52C236.847 6.71626 237.842 7.08108 238.505 7.81073C239.169 8.54037 239.799 9.50217 240.396 10.6961L244.674 20.0489H245.669L245.072 4.72632H202.686V63.5291C202.686 64.8557 202.454 65.917 201.99 66.713C201.592 67.4426 200.829 68.0396 199.702 68.5039L197.413 69.3994Z" fill="#E9EAF2"/>
<path d="M147.092 70.3944V69.3994L149.082 68.7029C151.337 67.9733 152.465 66.0828 152.465 63.0316V12.0891C152.465 10.7625 152.299 9.70117 151.967 8.90519C151.702 8.10922 150.939 7.4459 149.679 6.91525L147.092 5.72129V4.72632H166.295L184.702 52.8829L202.014 4.72632H214.224V5.72129L212.632 6.31827C211.371 6.78259 210.509 7.44591 210.045 8.30821C209.58 9.10419 209.348 10.1655 209.348 11.4921V63.5291C209.348 64.8557 209.514 65.8838 209.846 66.6135C210.177 67.3431 210.973 67.9733 212.234 68.5039L214.224 69.3994V70.3944H196.84V69.3994L198.93 68.5039C200.19 67.9733 200.986 67.3431 201.318 66.6135C201.649 65.8838 201.815 64.8557 201.815 63.5291V41.1422L202.014 12.6861L181.219 70.3944H176.244L154.554 13.3826L154.853 38.1573V63.2306C154.853 64.6899 155.052 65.8838 155.45 66.8125C155.914 67.6748 156.776 68.3049 158.036 68.7029L160.225 69.3994V70.3944H147.092Z" fill="#E9EAF2"/>
<rect x="18.708" y="43.5791" width="36.1281" height="14.8383" rx="3.22572" fill="#FF9E21"/>
<rect x="64.5137" y="43.5791" width="36.1281" height="14.8383" rx="3.22572" fill="#FF9E21"/>
<path d="M0 70.6754V31.4551H118.823V70.6754" stroke="#FF9E21" stroke-width="12.7829"/>
<path d="M50.2554 19.064H23.4045C21.632 19.064 20.2937 17.4592 20.6208 15.7171C21.0993 13.1686 21.7321 9.85246 22.3328 6.84425C23.2663 2.16885 27.1947 1 29.0423 1H44.5033C48.5873 1 50.9211 4.45342 51.5045 6.84425C51.8468 8.247 52.5239 12.4027 53.0523 15.8113C53.318 17.5245 51.9891 19.064 50.2554 19.064Z" fill="#FF9E21"/>
<path d="M96.0601 19.064H69.2092C67.4367 19.064 66.0983 17.4592 66.4254 15.7171C66.904 13.1686 67.5368 9.85246 68.1374 6.84425C69.0709 2.16885 72.9994 1 74.8469 1H90.308C94.392 1 96.7258 4.45342 97.3092 6.84425C97.6515 8.247 98.3286 12.4027 98.857 15.8113C99.1227 17.5245 97.7938 19.064 96.0601 19.064Z" fill="#FF9E21"/>
</g>
<defs>
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
    <div class="cover-meta">Relatório de Performance · Últimos ${overviewDays} dias · Gerado em ${dateStr}</div>
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
        <div style="font-size:9px;color:#aaa;margin-top:2px">${overviewDays}d</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">Engajamento</div>
        <div class="kpi-value">${fmtPct(overview.engagement.current)}</div>
        <div class="kpi-delta" style="color:${deltaColor(overview.engagement)}">${deltaArrow(overview.engagement)} ${Math.abs(overview.engagement.deltaPercent).toFixed(1)}%</div>
        <div style="font-size:9px;color:#aaa;margin-top:2px">${overviewDays}d</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">Alcance</div>
        <div class="kpi-value">${fmtNum(overview.reach.current)}</div>
        <div class="kpi-delta" style="color:${deltaColor(overview.reach)}">${deltaArrow(overview.reach)} ${Math.abs(overview.reach.deltaPercent).toFixed(1)}%</div>
        <div style="font-size:9px;color:#aaa;margin-top:2px">${overviewDays}d</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">Contas Engajadas</div>
        <div class="kpi-value">${fmtNum(overview.profileViews.current)}</div>
        <div class="kpi-delta" style="color:${deltaColor(overview.profileViews)}">${deltaArrow(overview.profileViews)} ${Math.abs(overview.profileViews.deltaPercent).toFixed(1)}%</div>
        <div style="font-size:9px;color:#aaa;margin-top:2px">28d fixo</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">Cliques no Link</div>
        <div class="kpi-value">${fmtNum(overview.websiteClicks.current)}</div>
        <div class="kpi-delta" style="color:${deltaColor(overview.websiteClicks)}">${deltaArrow(overview.websiteClicks)} ${Math.abs(overview.websiteClicks.deltaPercent).toFixed(1)}%</div>
        <div style="font-size:9px;color:#aaa;margin-top:2px">28d fixo</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">Taxa de Salvamentos</div>
        <div class="kpi-value">${fmtPct(overview.savesRate.current)}</div>
        <div class="kpi-delta" style="color:${deltaColor(overview.savesRate)}">${deltaArrow(overview.savesRate)} ${Math.abs(overview.savesRate.deltaPercent).toFixed(1)}%</div>
        <div style="font-size:9px;color:#aaa;margin-top:2px">${overviewDays}d</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">Posts Publicados</div>
        <div class="kpi-value">${overview.postsPublished.current}</div>
        <div class="kpi-delta" style="color:${deltaColor(overview.postsPublished)}">${deltaArrow(overview.postsPublished)} ${Math.abs(overview.postsPublished.deltaPercent).toFixed(1)}%</div>
        <div style="font-size:9px;color:#aaa;margin-top:2px">${overviewDays}d</div>
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
