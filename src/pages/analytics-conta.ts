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
  generateReport,
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
        ${Array(6).fill(`<div class="kpi-card">
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
        <button class="btn-primary" id="btn-gen-report"><i class="ph ph-file-pdf"></i> Gerar Relatório</button>
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
            ${posts.map(p => `
              <tr class="post-row" data-post-id="${p.id}" style="cursor:pointer">
                <td data-label="Data">${new Date(p.posted_at).toLocaleDateString('pt-BR')}</td>
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
    <div class="card animate-up">
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

  // Generate report
  document.getElementById('btn-gen-report')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-gen-report') as HTMLButtonElement;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Gerando...';
    try {
      const result = await generateReport(clientId);
      if (result.status === 'ready' && result.report_url) {
        showToast('Relatório gerado com sucesso!', 'success');
        window.open(result.report_url, '_blank', 'noopener');
      } else {
        showToast('Relatório em geração. Atualize em alguns minutos.', 'info');
      }
      await renderContent(container, clientId, cliente, account, state);
    } catch (e: any) {
      showToast(e.message || 'Erro ao gerar relatório', 'error');
      btn.disabled = false;
      btn.innerHTML = '<i class="ph ph-file-pdf"></i> Gerar Relatório';
    }
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
