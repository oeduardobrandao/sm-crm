export const REPORT_TEMPLATE = `<!DOCTYPE html>
<html lang="pt-BR" data-theme="{{THEME}}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Relatório — {{HANDLE}} — {{PERIOD}}</title>
<style>
  @page {
    size: A4;
    margin: 0;
  }

  :root {
    {{BRANDING_CSS}}
  }

  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  html, body {
    width: 210mm;
    min-height: 297mm;
    font-family: var(--font-main), 'Helvetica Neue', Arial, sans-serif;
    font-size: 11px;
    line-height: 1.5;
    color: var(--text-color);
    background: var(--bg-color);
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* Theme: dark */
  [data-theme="dark"] {
    --text-color: #e8eaf0;
    --text-muted: #9ca3af;
    --bg-color: #0d1117;
    --card-bg: #161b22;
    --card-border: rgba(255,255,255,0.06);
    --divider: rgba(255,255,255,0.08);
    --badge-bg: rgba(255,255,255,0.06);
    --cover-overlay: linear-gradient(135deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.4) 100%);
    --kpi-card-shadow: 0 2px 12px rgba(0,0,0,0.3);
    --subtle-glow: rgba(234,179,8,0.08);
  }

  /* Theme: light */
  [data-theme="light"] {
    --text-color: #1a1e26;
    --text-muted: #6b7280;
    --bg-color: #f8fafc;
    --card-bg: #ffffff;
    --card-border: rgba(0,0,0,0.08);
    --divider: rgba(0,0,0,0.08);
    --badge-bg: rgba(0,0,0,0.04);
    --cover-overlay: linear-gradient(135deg, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.6) 100%);
    --kpi-card-shadow: 0 2px 12px rgba(0,0,0,0.06);
    --subtle-glow: rgba(234,179,8,0.06);
  }

  /* ── Page containers ── */
  .page {
    width: 210mm;
    min-height: 297mm;
    padding: 20mm 18mm 16mm 18mm;
    page-break-after: always;
    position: relative;
    background: var(--bg-color);
    overflow: hidden;
  }

  .page:last-child {
    page-break-after: auto;
  }

  /* ── Cover page ── */
  .page--cover {
    padding: 0;
    display: flex;
    flex-direction: column;
  }

  .cover-header {
    position: relative;
    padding: 28mm 18mm 20mm 18mm;
    background: linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%);
    color: #fff;
    flex-shrink: 0;
  }

  .cover-header::after {
    content: '';
    position: absolute;
    bottom: -1px;
    left: 0;
    right: 0;
    height: 40px;
    background: var(--bg-color);
    clip-path: ellipse(60% 100% at 50% 100%);
  }

  .cover-logo {
    height: 36px;
    margin-bottom: 16px;
    object-fit: contain;
  }

  .cover-workspace {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 2px;
    text-transform: uppercase;
    opacity: 0.85;
    margin-bottom: 8px;
  }

  .cover-handle {
    font-size: 36px;
    font-weight: 800;
    line-height: 1.15;
    margin-bottom: 4px;
  }

  .cover-specialty {
    font-size: 14px;
    font-weight: 400;
    opacity: 0.75;
    margin-bottom: 6px;
  }

  .cover-period {
    display: inline-block;
    font-size: 13px;
    font-weight: 600;
    padding: 5px 16px;
    border-radius: 20px;
    background: rgba(255,255,255,0.2);
    backdrop-filter: blur(4px);
    margin-top: 10px;
  }

  .cover-body {
    flex: 1;
    padding: 14mm 18mm 16mm 18mm;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  /* ── Section headers ── */
  .section-title {
    font-size: 16px;
    font-weight: 800;
    color: var(--text-color);
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .section-title::before {
    content: '';
    width: 4px;
    height: 18px;
    border-radius: 2px;
    background: var(--primary);
    flex-shrink: 0;
  }

  .section-subtitle {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-bottom: 10px;
  }

  /* ── KPI cards ── */
  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
  }

  .kpi-card {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 12px;
    padding: 14px 14px 12px;
    box-shadow: var(--kpi-card-shadow);
    position: relative;
    overflow: hidden;
  }

  .kpi-card::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: var(--primary);
    opacity: 0.6;
    border-radius: 12px 12px 0 0;
  }

  .kpi-label {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--text-muted);
    margin-bottom: 6px;
  }

  .kpi-value {
    font-size: 22px;
    font-weight: 800;
    color: var(--text-color);
    line-height: 1.1;
    font-family: 'DM Mono', monospace, var(--font-main);
  }

  .kpi-unit {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-muted);
  }

  .kpi-delta {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 10px;
    font-weight: 700;
    margin-top: 4px;
    padding: 2px 8px;
    border-radius: 6px;
    font-family: 'DM Mono', monospace;
  }

  .kpi-delta--up {
    color: #22c55e;
    background: rgba(34,197,94,0.1);
  }

  .kpi-delta--down {
    color: #ef4444;
    background: rgba(239,68,68,0.1);
  }

  .kpi-delta--neutral {
    color: var(--text-muted);
    background: var(--badge-bg);
  }

  /* ── Card wrapper ── */
  .card {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 14px;
    padding: 18px;
    box-shadow: var(--kpi-card-shadow);
  }

  .card--highlight {
    background: linear-gradient(135deg, var(--card-bg) 0%, var(--subtle-glow) 100%);
    border-color: rgba(234,179,8,0.15);
  }

  /* ── Executive summary ── */
  .summary-text {
    font-size: 12px;
    line-height: 1.7;
    color: var(--text-color);
  }

  .summary-text ul {
    padding-left: 18px;
  }

  .summary-text li {
    margin-bottom: 4px;
  }

  .summary-text strong {
    color: var(--primary);
  }

  /* ── Highlight cards grid ── */
  .highlight-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .highlight-title {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--text-muted);
    margin-bottom: 10px;
  }

  .highlight-stat {
    font-size: 18px;
    font-weight: 800;
    color: var(--text-color);
    font-family: 'DM Mono', monospace;
  }

  .highlight-desc {
    font-size: 10px;
    color: var(--text-muted);
    margin-top: 4px;
  }

  /* ── Charts ── */
  .chart-container {
    width: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 8px 0;
  }

  .chart-container svg {
    width: 100%;
    height: auto;
    max-height: 200px;
  }

  .charts-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }

  /* ── Detailed KPI cards ── */
  .detailed-kpi-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
  }

  .detailed-kpi {
    text-align: center;
    padding: 14px 10px;
  }

  .detailed-kpi .kpi-value {
    font-size: 20px;
  }

  /* ── Top posts ── */
  .post-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .post-item {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 12px;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 10px;
  }

  .post-rank {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    background: var(--primary);
    color: var(--secondary);
    font-weight: 800;
    font-size: 13px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .post-thumb {
    width: 52px;
    height: 52px;
    border-radius: 8px;
    object-fit: cover;
    background: var(--badge-bg);
    flex-shrink: 0;
  }

  .post-info {
    flex: 1;
    min-width: 0;
  }

  .post-caption {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-color);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-bottom: 4px;
  }

  .post-badge {
    display: inline-block;
    font-size: 8px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    padding: 2px 8px;
    border-radius: 4px;
    background: var(--badge-bg);
    color: var(--primary);
    margin-right: 6px;
  }

  .post-stats {
    display: flex;
    gap: 14px;
    margin-top: 4px;
  }

  .post-stat {
    font-size: 10px;
    color: var(--text-muted);
    font-family: 'DM Mono', monospace;
  }

  .post-stat strong {
    color: var(--text-color);
    font-weight: 700;
  }

  /* ── Tags table ── */
  .tags-table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    font-size: 10px;
  }

  .tags-table th {
    text-align: left;
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--text-muted);
    padding: 8px 10px;
    border-bottom: 2px solid var(--divider);
  }

  .tags-table td {
    padding: 8px 10px;
    border-bottom: 1px solid var(--divider);
    color: var(--text-color);
  }

  .tags-table tr:last-child td {
    border-bottom: none;
  }

  .tag-name {
    font-weight: 700;
    color: var(--primary);
  }

  /* ── Demographics ── */
  .demo-grid {
    display: grid;
    grid-template-columns: 160px 1fr;
    gap: 16px;
    align-items: start;
  }

  .demo-bars {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .demo-bar-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .demo-bar-label {
    font-size: 10px;
    color: var(--text-muted);
    width: 50px;
    text-align: right;
    flex-shrink: 0;
  }

  .demo-bar-track {
    flex: 1;
    height: 10px;
    background: var(--badge-bg);
    border-radius: 5px;
    overflow: hidden;
  }

  .demo-bar-fill {
    height: 100%;
    border-radius: 5px;
    background: var(--primary);
  }

  .demo-bar-value {
    font-size: 10px;
    font-weight: 700;
    color: var(--text-color);
    width: 36px;
    font-family: 'DM Mono', monospace;
  }

  /* ── Location bars ── */
  .location-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }

  /* ── Heatmap ── */
  .heatmap-container svg {
    width: 100%;
    height: auto;
  }

  /* ── AI analysis ── */
  .ai-text {
    font-size: 11.5px;
    line-height: 1.75;
    color: var(--text-color);
  }

  .ai-text p {
    margin-bottom: 10px;
  }

  /* ── Recommendations ── */
  .rec-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .rec-item {
    display: flex;
    gap: 12px;
    padding: 12px;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 10px;
  }

  .rec-priority {
    width: 6px;
    border-radius: 3px;
    flex-shrink: 0;
  }

  .rec-priority--high { background: #ef4444; }
  .rec-priority--medium { background: var(--primary); }
  .rec-priority--low { background: var(--accent); }

  .rec-content {
    flex: 1;
  }

  .rec-title {
    font-size: 12px;
    font-weight: 700;
    color: var(--text-color);
    margin-bottom: 3px;
  }

  .rec-desc {
    font-size: 10.5px;
    line-height: 1.6;
    color: var(--text-muted);
  }

  /* ── Goals ── */
  .goals-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 10px;
  }

  .goal-card {
    padding: 14px;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 10px;
    text-align: center;
  }

  .goal-metric {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--text-muted);
    margin-bottom: 4px;
  }

  .goal-target {
    font-size: 20px;
    font-weight: 800;
    color: var(--primary);
    font-family: 'DM Mono', monospace;
  }

  .goal-rationale {
    font-size: 10px;
    color: var(--text-muted);
    margin-top: 4px;
  }

  /* ── Footer ── */
  .page-footer {
    position: absolute;
    bottom: 10mm;
    left: 18mm;
    right: 18mm;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 8px;
    color: var(--text-muted);
    border-top: 1px solid var(--divider);
    padding-top: 8px;
  }

  .page-footer-brand {
    font-weight: 700;
    color: var(--primary);
  }

  /* ── Utilities ── */
  .mt-sm { margin-top: 8px; }
  .mt-md { margin-top: 14px; }
  .mt-lg { margin-top: 20px; }
  .mb-sm { margin-bottom: 8px; }
  .gap-sm { gap: 8px; }
</style>
</head>
<body>

<!-- PAGE 1: Cover + Executive Summary + KPIs + Highlights -->
<div class="page page--cover">
  <div class="cover-header">
    {{COVER_HTML}}
  </div>
  <div class="cover-body">
    <div>
      <div class="section-title">Resumo Executivo</div>
      <div class="card card--highlight">
        <div class="summary-text">
          {{EXECUTIVE_SUMMARY}}
        </div>
      </div>
    </div>

    <div>
      <div class="section-title">Métricas Principais</div>
      <div class="kpi-grid">
        {{KPI_CARDS}}
      </div>
    </div>

    <div>
      <div class="section-title">Destaques</div>
      <div class="highlight-grid">
        {{HIGHLIGHTS}}
      </div>
    </div>
  </div>
  {{FOOTER}}
</div>

<!-- PAGE 2: Charts + Detailed KPIs -->
<div class="page">
  <div class="section-title">Evolução de Seguidores</div>
  <div class="card">
    <div class="chart-container">
      {{FOLLOWER_CHART}}
    </div>
  </div>

  <div class="mt-lg">
    <div class="section-title">Desempenho por Formato</div>
    <div class="card">
      <div class="chart-container">
        {{CONTENT_CHART}}
      </div>
    </div>
  </div>

  <div class="mt-lg">
    <div class="section-title">Métricas Detalhadas</div>
    <div class="detailed-kpi-grid">
      {{DETAILED_KPIS}}
    </div>
  </div>
  {{FOOTER}}
</div>

<!-- PAGE 3: Top Posts + Tags Performance -->
<div class="page">
  <div class="section-title">Top Publicações</div>
  <div class="post-list">
    {{TOP_POSTS}}
  </div>

  {{#IF_HAS_TAGS}}
  <div class="mt-lg">
    <div class="section-title">Performance por Tópico</div>
    <div class="card">
      <table class="tags-table">
        <thead>
          <tr>
            <th>Tópico</th>
            <th>Posts</th>
            <th>Eng. Médio</th>
            <th>Alcance Médio</th>
          </tr>
        </thead>
        <tbody>
          {{TAGS_TABLE}}
        </tbody>
      </table>
    </div>
  </div>
  {{/IF_HAS_TAGS}}

  {{FOOTER}}
</div>

<!-- PAGE 4: Demographics + Location + Heatmap -->
{{#IF_HAS_AUDIENCE}}
<div class="page">
  <div class="section-title">Demografia</div>
  <div class="demo-grid">
    {{DEMOGRAPHICS}}
  </div>

  <div class="mt-lg">
    <div class="section-title">Localização</div>
    <div class="location-grid">
      {{LOCATION}}
    </div>
  </div>

  <div class="mt-lg">
    <div class="section-title">Melhores Horários</div>
    <div class="card">
      <div class="heatmap-container">
        {{HEATMAP}}
      </div>
    </div>
  </div>
  {{FOOTER}}
</div>
{{/IF_HAS_AUDIENCE}}

<!-- PAGE 5: AI Analysis + Recommendations + Goals -->
<div class="page">
  <div class="section-title">Análise</div>
  <div class="card">
    <div class="ai-text">
      {{AI_ANALYSIS}}
    </div>
  </div>

  <div class="mt-lg">
    <div class="section-title">Recomendações</div>
    <div class="rec-list">
      {{RECOMMENDATIONS}}
    </div>
  </div>

  <div class="mt-lg">
    <div class="section-title">Metas Sugeridas</div>
    <div class="goals-grid">
      {{GOALS}}
    </div>
  </div>
  {{FOOTER}}
</div>

</body>
</html>`;
