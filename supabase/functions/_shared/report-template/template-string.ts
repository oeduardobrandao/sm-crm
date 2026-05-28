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
    background: rgba(255,255,255,0.25);
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

  /* ── Posts card grid ── */
  .post-card-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    max-width: 154mm;
    margin: 0 auto;
    gap: 8px;
    overflow: hidden;
  }

  .post-card {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 8px;
    overflow: hidden;
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .post-card-thumb {
    position: relative;
    width: 100%;
    aspect-ratio: 3/4;
    background: var(--badge-bg);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .post-card-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .post-card-rank {
    position: absolute;
    top: 5px;
    left: 5px;
    width: 18px;
    height: 18px;
    border-radius: 5px;
    background: var(--primary);
    color: var(--secondary);
    font-weight: 800;
    font-size: 8.5px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .post-card-type {
    position: absolute;
    top: 5px;
    right: 5px;
    font-size: 6.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 1px 5px;
    border-radius: 3px;
    background: rgba(0,0,0,0.55);
    color: #fff;
  }

  .post-card-body {
    padding: 6px 7px;
  }

  .post-card-caption {
    font-size: 7.5px;
    font-weight: 500;
    color: var(--text-color);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-bottom: 4px;
    line-height: 1.3;
  }

  .post-card-stats {
    display: flex;
    gap: 6px;
    flex-wrap: nowrap;
    overflow: hidden;
  }

  .post-card-stat {
    font-size: 7.5px;
    color: var(--text-muted);
    font-family: 'DM Mono', monospace;
    white-space: nowrap;
  }

  .post-card-stat strong {
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
    width: 80px;
    text-align: right;
    flex-shrink: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
      <div class="section-title">Resumo</div>
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

<!-- PAGE 3: All Posts + Tags Performance -->
<div class="page">
  <div class="section-title">Publicações</div>
  {{TOP_POSTS}}

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

  {{#IF_HAS_HEATMAP}}
  <div class="mt-lg">
    <div class="section-title">Melhores Horários</div>
    <div class="card">
      <div class="heatmap-container">
        {{HEATMAP}}
      </div>
    </div>
  </div>
  {{/IF_HAS_HEATMAP}}

  {{FOOTER}}
</div>
{{/IF_HAS_AUDIENCE}}

</body>
</html>`;
