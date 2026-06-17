import { useMemo } from 'react';

interface ReportPreviewProps {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  fontFamily: string;
  theme: 'dark' | 'light';
}

const GOOGLE_FONTS_MAP: Record<string, string> = {
  'DM Sans': 'DM+Sans:wght@400;600;800',
  Inter: 'Inter:wght@400;600;800',
  Poppins: 'Poppins:wght@400;600;800',
  Montserrat: 'Montserrat:wght@400;600;800',
  'Plus Jakarta Sans': 'Plus+Jakarta+Sans:wght@400;600;800',
};

export function ReportPreview({
  primaryColor,
  secondaryColor,
  accentColor,
  fontFamily,
  theme,
}: ReportPreviewProps) {
  const srcdoc = useMemo(() => {
    const fontParam = GOOGLE_FONTS_MAP[fontFamily] ?? GOOGLE_FONTS_MAP['DM Sans'];
    const fontImport = `https://fonts.googleapis.com/css2?family=${fontParam}&display=swap`;

    return `<!DOCTYPE html>
<html lang="pt-BR" data-theme="${theme}">
<head>
<meta charset="UTF-8">
<link rel="stylesheet" href="${fontImport}">
<style>
  :root {
    --primary: ${primaryColor};
    --secondary: ${secondaryColor};
    --accent: ${accentColor};
    --font-main: '${fontFamily}';
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  [data-theme="dark"] {
    --text-color: #e8eaf0;
    --text-muted: #9ca3af;
    --bg-color: #0d1117;
    --card-bg: #161b22;
    --card-border: rgba(255,255,255,0.06);
    --divider: rgba(255,255,255,0.08);
    --badge-bg: rgba(255,255,255,0.06);
    --kpi-card-shadow: 0 2px 12px rgba(0,0,0,0.3);
    --subtle-glow: rgba(234,179,8,0.08);
  }

  [data-theme="light"] {
    --text-color: #1a1e26;
    --text-muted: #6b7280;
    --bg-color: #f8fafc;
    --card-bg: #ffffff;
    --card-border: rgba(0,0,0,0.08);
    --divider: rgba(0,0,0,0.08);
    --badge-bg: rgba(0,0,0,0.04);
    --kpi-card-shadow: 0 2px 12px rgba(0,0,0,0.06);
    --subtle-glow: rgba(234,179,8,0.06);
  }

  body {
    font-family: var(--font-main), 'Helvetica Neue', Arial, sans-serif;
    font-size: 11px;
    line-height: 1.5;
    color: var(--text-color);
    background: var(--bg-color);
    overflow: hidden;
  }

  .page {
    width: 210mm;
    min-height: 297mm;
    position: relative;
    background: var(--bg-color);
    overflow: hidden;
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

  .summary-text {
    font-size: 12px;
    line-height: 1.7;
    color: var(--text-color);
  }

  .summary-text strong {
    color: var(--primary);
  }

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
    font-family: var(--font-main), sans-serif;
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
    font-family: var(--font-main), sans-serif;
    color: #22c55e;
    background: rgba(34,197,94,0.1);
  }

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
    font-family: var(--font-main), sans-serif;
  }

  .highlight-desc {
    font-size: 10px;
    color: var(--text-muted);
    margin-top: 4px;
  }

  .breakdown-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }

  .breakdown-label {
    font-size: 10px;
    font-weight: 600;
    color: var(--text-muted);
    width: 70px;
    text-align: right;
    flex-shrink: 0;
  }

  .breakdown-track {
    flex: 1;
    height: 12px;
    background: var(--badge-bg);
    border-radius: 6px;
    overflow: hidden;
  }

  .breakdown-fill {
    height: 100%;
    border-radius: 6px;
  }

  .breakdown-value {
    font-size: 10px;
    font-weight: 700;
    color: var(--text-color);
    width: 32px;
    font-family: var(--font-main), sans-serif;
  }

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

  .rec-content { flex: 1; }

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
</style>
</head>
<body>
<div class="page">
  <div class="cover-header">
    <div class="cover-workspace">SUA AGÊNCIA</div>
    <div class="cover-handle">@exemplo_cliente</div>
    <div class="cover-specialty">Saúde e Bem-estar</div>
    <div class="cover-period">Maio 2026</div>
  </div>
  <div class="cover-body">
    <div>
      <div class="section-title">Resumo</div>
      <div class="card card--highlight">
        <div class="summary-text">
          O perfil teve um desempenho <strong>positivo</strong> neste mês, com aumento de <strong>12,4%</strong> no engajamento e crescimento consistente da base de seguidores.
        </div>
      </div>
    </div>
    <div>
      <div class="section-title">Métricas Principais</div>
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-label">Seguidores</div>
          <div class="kpi-value">24.8K</div>
          <div class="kpi-delta">▲ 3,2%</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Alcance</div>
          <div class="kpi-value">142K</div>
          <div class="kpi-delta">▲ 8,7%</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Engajamento</div>
          <div class="kpi-value">4,6%</div>
          <div class="kpi-delta">▲ 12,4%</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Impressões</div>
          <div class="kpi-value">389K</div>
          <div class="kpi-delta">▲ 5,1%</div>
        </div>
      </div>
    </div>
    <div>
      <div class="section-title">Desempenho por Formato</div>
      <div class="card">
        <div class="breakdown-row">
          <div class="breakdown-label">Reels</div>
          <div class="breakdown-track"><div class="breakdown-fill" style="width:68%;background:var(--primary)"></div></div>
          <div class="breakdown-value">68%</div>
        </div>
        <div class="breakdown-row">
          <div class="breakdown-label">Carrosséis</div>
          <div class="breakdown-track"><div class="breakdown-fill" style="width:22%;background:var(--accent)"></div></div>
          <div class="breakdown-value">22%</div>
        </div>
        <div class="breakdown-row">
          <div class="breakdown-label">Imagens</div>
          <div class="breakdown-track"><div class="breakdown-fill" style="width:10%;background:var(--secondary)"></div></div>
          <div class="breakdown-value">10%</div>
        </div>
      </div>
    </div>
  </div>
  <div class="page-footer">
    <span class="page-footer-brand">SUA AGÊNCIA</span>
    <span>Relatório gerado automaticamente · Maio 2026</span>
  </div>
</div>
</body>
</html>`;
  }, [primaryColor, secondaryColor, accentColor, fontFamily, theme]);

  return (
    <div
      style={{
        borderRadius: 12,
        overflow: 'hidden',
        border: '1px solid var(--border-color)',
        background: theme === 'dark' ? '#0d1117' : '#f8fafc',
      }}
    >
      <div
        style={{
          fontSize: '0.7rem',
          fontWeight: 600,
          textTransform: 'uppercase' as const,
          letterSpacing: '0.5px',
          color: 'var(--text-muted)',
          padding: '8px 12px',
          borderBottom: '1px solid var(--border-color)',
        }}
      >
        Prévia do relatório
      </div>
      <div
        style={{
          height: 380,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <iframe
          srcDoc={srcdoc}
          title="Prévia do relatório"
          sandbox="allow-same-origin"
          style={{
            border: 'none',
            width: '793px',
            height: '1122px',
            transform: 'scale(0.36)',
            transformOrigin: 'top left',
            pointerEvents: 'none',
          }}
        />
      </div>
    </div>
  );
}
