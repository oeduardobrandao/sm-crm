// Monthly Instagram report — v2 document skeleton.
//
// Derived from docs/superpowers/specs/2026-07-22-analytics-report-redesign-prototype.html
// (the visual source of truth). Only two things changed:
//   1. the prototype's Google Fonts <link> tags became `<style>{{FONTS_CSS}}</style>`
//      (Gotenberg has no network access — fonts must be embedded), and
//   2. every fixture value became a {{PLACEHOLDER}} filled in by render.ts.
//
// The `@media screen and (max-width: 860px)` block is what makes the same HTML
// readable inside the Client Hub iframe on a phone — do not remove it.

export const REPORT_TEMPLATE = `<!DOCTYPE html>
<html lang="pt-BR" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Relatório — {{HANDLE}} — {{PERIOD}}</title>
<style>{{FONTS_CSS}}</style>
<style>
  @page { size: A4; margin: 0; }

  :root {
    /* tokens — espelham o resolvedor de tema do Hub (theme.ts) */
    {{ACCENT_VARS}}
    --font-display: 'Fraunces', ui-serif, Georgia, serif;
    --font-sans: 'Instrument Sans', ui-sans-serif, system-ui, sans-serif;
    --paper: #FAFAF7;
    --card: #ffffff;
    --ink: #1C1917;
    --tx2: #525252;
    --tx3: #8A8A8A;
    --bd: rgba(231, 229, 228, 0.9);
    --hairline: rgba(28, 25, 23, 0.08);
    --soft: #F4F4F4;
    --card-shadow: 0 1px 0 rgba(0,0,0,0.02), 0 1px 2px rgba(28, 25, 23, 0.04);
    --up: #1a7f4b;
    --down: #b3423a;
    --up-bg: rgba(26, 127, 75, 0.08);
    --down-bg: rgba(179, 66, 58, 0.08);
    /* paleta de dados (fixa, validada p/ daltonismo) — nunca recebe a cor da marca */
    --fmt-reel: #D97706;
    --fmt-car: #0D9488;
    --fmt-img: #A21CAF;
    --heat-200: #F5DCAE;
    --heat-250: #F0CF93;
    --heat-300: #ECC178;
    --heat-400: #E0A344;
    --heat-500: #CE8418;
    --heat-600: #B26A08;
    --heat-700: #8F5306;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  html, body {
    font-family: var(--font-sans);
    font-feature-settings: 'ss01', 'cv11';
    font-size: 12px;
    line-height: 1.55;
    color: var(--ink);
    background: #ECEBE7;
    -webkit-font-smoothing: antialiased;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .display { font-family: var(--font-display); font-optical-sizing: auto; letter-spacing: -0.01em; }
  .num { font-variant-numeric: tabular-nums; }
  .dot { display: inline-block; width: 7px; height: 7px; border-radius: 2px; margin-right: 6px; vertical-align: 0; }
  .dot.reel { background: var(--fmt-reel); }
  .dot.car { background: var(--fmt-car); }
  .dot.img { background: var(--fmt-img); }
  .empty { font-size: 11px; color: var(--tx3); text-align: center; padding: 22px 0; }

  /* ── páginas ── */
  .page {
    width: 210mm;
    /* Full A4. pdf.ts sizes the Gotenberg sheet a hair larger than this box, so
       the page neither overflows onto a blank sheet nor leaves the body colour
       showing at the edges. Change the two together or not at all. */
    min-height: 297mm;
    margin: 0 auto;
    padding: 16mm 16mm 22mm;
    page-break-after: always;
    position: relative;
    background: var(--paper);
    display: flex;
    flex-direction: column;
  }
  .page:last-child { page-break-after: auto; }
  @media screen { .page { margin-bottom: 12px; box-shadow: 0 2px 18px rgba(0,0,0,0.08); } }

  /* ── rodapé ── */
  .page-footer {
    position: absolute;
    bottom: 9mm; left: 16mm; right: 16mm;
    display: flex; justify-content: space-between; align-items: baseline;
    font-size: 9px;
    color: var(--tx3);
    border-top: 1px solid var(--hairline);
    padding-top: 9px;
  }
  .page-footer b { color: var(--ink); font-weight: 600; }

  /* ── leitura do mês (assinatura) ── */
  .takeaway { margin-bottom: 18px; max-width: 152mm; }
  .takeaway .lbl {
    font-size: 10px; font-weight: 600; color: var(--tx3); margin-bottom: 4px;
  }
  .takeaway .lbl::before {
    content: ''; display: inline-block; width: 18px; height: 2px;
    background: var(--acc);
    margin-right: 10px; vertical-align: 3px;
  }
  .takeaway .txt {
    font-family: var(--font-display); font-size: 15.5px; font-weight: 500;
    letter-spacing: -0.01em; line-height: 1.5; color: var(--ink);
  }
  .takeaway .hit { font-weight: 700; text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 3px; text-decoration-color: rgba(28,25,23,0.35); }

  /* ── títulos ── */
  .sec { display: flex; align-items: baseline; gap: 12px; margin: 22px 0 12px; }
  .sec:first-of-type { margin-top: 0; }
  .sec h2 { font-family: var(--font-display); font-size: 21px; font-weight: 600; letter-spacing: -0.01em; }
  .sec .idx { font-size: 10px; font-weight: 500; color: var(--tx3); }
  .sec .rule { flex: 1; border-top: 1px solid var(--hairline); transform: translateY(-5px); }

  /* ═══ CAPA ═══ */
  .cover {
    padding: 0;
    background: var(--ink);
    color: #FAFAF7;
    justify-content: space-between;
  }
  /* Edge bleed. Whatever the sheet does at its margins, something has to be
     painted there or the body colour shows through — most visibly on the
     full-bleed dark cover.
     Two independent mechanisms, because the exact cause of the residual seam
     could not be reproduced outside a real Gotenberg render:
       1. the printed body carries the paper colour, so a seam beside a content
          page is paper-on-paper instead of the grey screen backdrop;
       2. the cover paints ink well past its own box, which the sheet clips. */
  @media print {
    html, body { background: var(--paper); }
    .cover { box-shadow: 0 0 0 8mm var(--ink); }
    .cover::before {
      content: '';
      position: absolute;
      top: -8mm; right: -8mm; bottom: -8mm; left: -8mm;
      background: var(--ink);
      z-index: 0;
    }
    .cover > * { position: relative; z-index: 1; }
  }
  .cover-top { padding: 20mm 18mm 0; display: flex; justify-content: space-between; align-items: flex-start; }
  /* logo do workspace (branding.logo_base64) sobre placa clara — funciona com logo de qualquer cor */
  .cover-logo-plate {
    display: inline-flex; align-items: center;
    background: #FAFAF7; border-radius: 10px; padding: 9px 14px;
    margin-bottom: 12px;
  }
  .cover-logo-plate img { display: block; height: 26px; max-width: 150px; object-fit: contain; }
  .cover-brand { font-size: 13px; font-weight: 700; letter-spacing: 0.01em; }
  .cover-doc { font-size: 10px; font-weight: 500; color: rgba(250,250,247,0.6); text-align: right; line-height: 1.7; }
  .cover-mid { padding: 0 18mm; }
  .cover-month { font-size: 13px; font-weight: 500; color: rgba(250,250,247,0.65); margin-bottom: 16px; }
  .cover-month::before {
    content: ''; display: inline-block; width: 18px; height: 2px;
    background: rgba(250,250,247,0.9);
    margin-right: 10px; vertical-align: 4px;
  }
  .cover-handle {
    font-family: var(--font-display); font-size: 54px; font-weight: 600;
    letter-spacing: -0.02em; line-height: 1.04;
    overflow-wrap: anywhere;
  }
  .cover-spec { font-size: 15px; font-weight: 400; color: rgba(250,250,247,0.7); margin-top: 12px; }
  /* splash art do workspace (upload próprio) — faixa 21:9, o mesmo formato que a
     página de Configurações pede no upload.
     A proporção fixa também é o que faz o object-fit funcionar: com flex 1 a
     altura da caixa vinha da distribuição flex, e altura 100% da imagem não
     resolve contra isso — ela caía na altura natural e sobrava uma faixa escura
     embaixo. Com aspect-ratio a altura é definida e o recorte volta a valer. */
  .cover-art {
    flex: 0 0 auto;
    aspect-ratio: 21 / 9;
    margin: 12mm 18mm 10mm;
    border-radius: 14px;
    overflow: hidden;
    background: #26221F;
  }
  .cover-art img, .cover-art svg { width: 100%; height: 100%; object-fit: cover; display: block; }
  .cover-bottom { padding: 0 18mm 18mm; }
  .cover-teaser {
    border-top: 1px solid rgba(250,250,247,0.18);
    display: grid; grid-template-columns: 1fr 1fr 1fr;
    padding-top: 18px; gap: 18px;
  }
  .cover-teaser .t-label { font-size: 10px; font-weight: 500; color: rgba(250,250,247,0.6); }
  .cover-teaser .t-value { font-family: var(--font-display); font-size: 32px; font-weight: 500; letter-spacing: -0.02em; margin-top: 4px; }
  .cover-teaser .t-delta { font-size: 10px; font-weight: 600; margin-top: 3px; color: rgba(250,250,247,0.75); }

  /* ═══ KPI cards ═══ */
  .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  .kpi {
    background: var(--card);
    border: 1px solid var(--bd);
    border-radius: 12px;
    box-shadow: var(--card-shadow);
    padding: 17px 17px 15px;
  }
  .kpi .k-label { font-size: 10px; font-weight: 500; color: var(--tx2); }
  .kpi .k-value { font-family: var(--font-display); font-size: 29px; font-weight: 500; letter-spacing: -0.02em; margin-top: 7px; line-height: 1; }
  .kpi .k-value small { font-size: 16px; color: var(--tx2); }
  .delta {
    display: inline-block; font-size: 9.5px; font-weight: 600;
    margin-top: 9px; padding: 2.5px 9px; border-radius: 9999px;
  }
  .delta.up { color: var(--up); background: var(--up-bg); }
  .delta.down { color: var(--down); background: var(--down-bg); }
  .delta.flat { color: var(--tx2); background: var(--soft); }
  .delta-note { display: block; font-size: 8.5px; color: var(--tx3); margin-top: 5px; }

  /* resumo */
  .summary {
    background: var(--card);
    border: 1px solid var(--bd);
    border-radius: 12px;
    box-shadow: var(--card-shadow);
    padding: 24px 26px;
    font-size: 13px;
    line-height: 1.8;
  }
  .summary strong { font-weight: 700; }
  .summary p + p { margin-top: 10px; }
  .summary ul { padding-left: 18px; }
  .summary li { margin-bottom: 2px; }

  /* índice */
  /* auto-fit (prototype: repeat(4, 1fr)) so a 2- or 3-entry index still fills the row */
  .toc { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
  .toc-item {
    border: 1px solid var(--bd); border-radius: 12px; padding: 13px 15px;
    background: var(--card); box-shadow: var(--card-shadow);
  }
  .toc-item .tc-n { font-size: 10px; font-weight: 600; color: var(--tx3); }
  .toc-item .tc-t { font-size: 11.5px; font-weight: 600; margin-top: 3px; }

  /* destaques */
  .hl-grid { display: grid; grid-template-columns: 1.25fr 1fr; gap: 10px; }
  .hl {
    background: var(--card); border: 1px solid var(--bd); border-radius: 12px;
    box-shadow: var(--card-shadow); padding: 20px 22px;
  }
  .hl .h-label { font-size: 10px; font-weight: 500; color: var(--tx2); margin-bottom: 9px; }
  .hl .h-big { font-family: var(--font-display); font-size: 26px; font-weight: 500; letter-spacing: -0.02em; }
  .hl .h-big .unit { font-family: var(--font-sans); font-size: 12px; color: var(--tx2); font-weight: 500; }
  .hl .h-desc { font-size: 10.5px; color: var(--tx2); margin-top: 4px; }
  .hl .h-caption { font-size: 11.5px; font-weight: 600; margin-top: 9px; line-height: 1.45; }
  .mix { display: flex; gap: 6px; margin-top: 12px; }
  .mix .m-chip { flex: 1; text-align: center; border: 1px solid var(--bd); border-radius: 10px; padding: 8px 4px; }
  .mix .m-n { font-family: var(--font-display); font-size: 16px; font-weight: 500; }
  .mix .m-t { font-size: 8.5px; font-weight: 500; color: var(--tx2); margin-top: 1px; }

  /* ═══ gráficos ═══ */
  .chart-card {
    background: var(--card); border: 1px solid var(--bd); border-radius: 12px;
    box-shadow: var(--card-shadow); padding: 18px 18px 10px;
  }
  .chart-card svg { width: 100%; height: auto; display: block; }
  .axis { font-family: 'Instrument Sans', sans-serif; font-size: 9.5px; fill: var(--tx3); }

  /* formatos */
  .fmt-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .fmt {
    background: var(--card); border: 1px solid var(--bd); border-radius: 12px;
    box-shadow: var(--card-shadow); padding: 16px 17px;
  }
  .fmt .f-head { display: flex; justify-content: space-between; align-items: baseline; }
  .fmt .f-name { font-size: 13px; font-weight: 700; }
  .fmt .f-count { font-size: 9.5px; color: var(--tx3); }
  .fmt .f-reach { font-family: var(--font-display); font-size: 24px; font-weight: 500; letter-spacing: -0.02em; margin-top: 10px; }
  .fmt .f-reach-l { font-size: 9px; color: var(--tx3); margin-top: 1px; }
  .fmt .f-bar { height: 6px; border-radius: 4px; background: var(--soft); margin-top: 11px; overflow: hidden; }
  .fmt .f-bar i { display: block; height: 100%; border-radius: 4px; background: var(--ink); }
  .fmt .f-eng { display: flex; justify-content: space-between; align-items: baseline; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--hairline); }
  .fmt .f-eng-l { font-size: 9.5px; color: var(--tx2); }
  .fmt .f-eng-v { font-size: 13.5px; font-weight: 700; }
  .fmt--reel .f-bar i { background: var(--fmt-reel); }
  .fmt--car .f-bar i { background: var(--fmt-car); }
  .fmt--img .f-bar i { background: var(--fmt-img); }
  .fmt.lead { border-color: var(--ink); box-shadow: 0 0 0 1px var(--ink), var(--card-shadow); }
  .lead-chip {
    display: inline-block; font-size: 8px; font-weight: 600;
    color: var(--acc-fg); background: var(--acc);
    border-radius: 9999px; padding: 2.5px 8px; margin-left: 7px; vertical-align: 2px;
  }

  .aux-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }

  /* ═══ publicações ═══ */
  .post-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  /* A month with few posts left up to 73% of the A4 sheet blank under the default
     3-up grid, which reads to the client as a rendering fault. When page 4 carries
     ONLY the cards, the grid widens them to fill the sheet; the density steps below
     were each measured against the A4 box with worst-case (clamped) captions.
     When the page also carries the list rows or the topics table, render.ts sends
     no modifier and the tuned 3-up/16:9 layout applies unchanged. */
  .post-grid.pg-solo, .post-grid.pg-duo { grid-template-columns: 1fr; gap: 14px; }
  .post-grid.pg-solo .p-thumb { aspect-ratio: 1/1; }
  .post-grid.pg-duo .p-thumb { aspect-ratio: 2/1; }
  .post-grid.pg-quad { grid-template-columns: repeat(2, 1fr); gap: 12px; }
  .post-grid.pg-quad .p-thumb { aspect-ratio: 4/3; }
  .post-grid.pg-six { grid-template-columns: repeat(2, 1fr); gap: 12px; }
  .post-grid.pg-six .p-thumb { aspect-ratio: 16/9; }

  .post-grid.pg-solo .p-body, .post-grid.pg-duo .p-body { padding: 13px 16px 15px; }
  .post-grid.pg-solo .p-caption, .post-grid.pg-duo .p-caption { font-size: 12px; min-height: 34px; }
  /* space-between across a full-width card scatters the four figures to the
     margins; at this width they group left instead. */
  .post-grid.pg-solo .p-stats, .post-grid.pg-duo .p-stats {
    font-size: 10px; margin-top: 10px; justify-content: flex-start; gap: 26px;
  }
  .post {
    background: var(--card); border: 1px solid var(--bd); border-radius: 12px;
    box-shadow: var(--card-shadow); overflow: hidden;
  }
  /* 16/9 (prototype: 4/3.4) — the taller crop pushed page 4 past the A4 box once
     the 6 list rows and the topics table were present. See render.ts page-fit caps. */
  .post .p-thumb { position: relative; aspect-ratio: 16/9; background: linear-gradient(150deg, #EDECEA, #DEDDD9); display: flex; align-items: center; justify-content: center; color: var(--tx3); }
  .post .p-thumb img { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; display: block; }
  .post .p-rank {
    position: absolute; top: 8px; left: 8px; min-width: 22px; height: 22px; padding: 0 5px;
    border-radius: 9999px; background: var(--acc); color: var(--acc-fg);
    font-size: 10.5px; font-weight: 600;
    display: flex; align-items: center; justify-content: center;
  }
  .post .p-type {
    position: absolute; top: 8px; right: 8px; font-size: 8.5px; font-weight: 600;
    padding: 2.5px 8px; border-radius: 9999px;
    background: rgba(250, 250, 247, 0.92); color: var(--ink); border: 1px solid var(--bd);
  }
  .post .p-body { padding: 10px 12px 12px; }
  .post .p-caption {
    font-size: 10.5px; font-weight: 600; line-height: 1.4;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    min-height: 29px;
  }
  .post .p-stats { display: flex; justify-content: space-between; margin-top: 8px; font-size: 9px; color: var(--tx3); }
  .post .p-stats b { color: var(--ink); font-weight: 600; }

  .post-rest {
    margin-top: 12px; background: var(--card); border: 1px solid var(--bd);
    border-radius: 12px; box-shadow: var(--card-shadow);
  }
  .post-rest .r-row {
    display: grid; grid-template-columns: 30px 1fr 64px 58px 52px; gap: 10px; align-items: center;
    padding: 7px 15px; border-top: 1px solid var(--hairline); font-size: 10.5px;
  }
  .post-rest .r-row:first-child { border-top: none; }
  .post-rest .r-rank { font-size: 10px; font-weight: 500; color: var(--tx3); }
  .post-rest .r-cap { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .post-rest .r-m { font-size: 9.5px; color: var(--tx3); text-align: right; }
  .post-rest .r-m b { color: var(--ink); font-weight: 600; }

  /* tópicos */
  .topics {
    background: var(--card); border: 1px solid var(--bd); border-radius: 12px;
    box-shadow: var(--card-shadow); padding: 6px 0;
  }
  .topics table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
  .topics th {
    font-size: 9.5px; font-weight: 600; color: var(--tx3); text-align: left;
    padding: 9px 18px 7px; border-bottom: 1px solid var(--hairline);
  }
  .topics th.r, .topics td.r { text-align: right; }
  .topics td { padding: 8px 18px; border-bottom: 1px solid var(--hairline); }
  .topics tr:last-child td { border-bottom: none; }
  /* same wrap guard as .post-rest .r-cap — a long tag name would otherwise wrap the
     row and eat page 4's remaining slack */
  .topics .t-name { font-weight: 700; }
  .topics .t-name span {
    display: block; max-width: 46mm;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .topics .t-bar { display: inline-block; vertical-align: middle; height: 6px; border-radius: 3px; background: var(--ink); margin-right: 9px; }

  /* ═══ audiência ═══ */
  .aud-grid { display: grid; grid-template-columns: 195px 1fr; gap: 12px; }
  .panel {
    background: var(--card); border: 1px solid var(--bd); border-radius: 12px;
    box-shadow: var(--card-shadow); padding: 14px 17px;
  }
  .panel .pn-label { font-size: 10px; font-weight: 500; color: var(--tx2); margin-bottom: 13px; }
  .donut-wrap { display: flex; align-items: center; gap: 4px; flex-direction: column; }
  .legend { display: flex; gap: 14px; margin-top: 10px; font-size: 9.5px; color: var(--tx2); }
  .legend i { display: inline-block; width: 8px; height: 8px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; }
  .bars { display: flex; flex-direction: column; gap: 9px; }
  .bar-row { display: grid; grid-template-columns: 78px 1fr 46px; align-items: center; gap: 10px; }
  .bar-row .b-l { font-size: 10px; color: var(--tx2); text-align: right; }
  .bar-row .b-track { height: 8px; border-radius: 5px; background: var(--soft); overflow: hidden; }
  .bar-row .b-fill { height: 100%; border-radius: 5px; background: var(--heat-400); }
  .bar-row .b-fill.alt { background: var(--heat-400); }
  .bar-row .b-v { font-size: 10px; font-weight: 600; }
  .loc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

  /* heatmap */
  .heat-table { width: 100%; border-collapse: separate; border-spacing: 3px; }
  .heat-table td { height: 18px; border-radius: 5px; background: var(--soft); }
  .heat-table .hd { font-size: 8.5px; color: var(--tx3); background: none; text-align: center; height: auto; }
  .heat-table .day { font-size: 9.5px; color: var(--tx2); background: none; text-align: right; padding-right: 8px; width: 36px; }
  .heat-top { display: flex; gap: 8px; margin-top: 13px; }
  .heat-chip {
    font-size: 10px; font-weight: 500; padding: 5px 12px; border-radius: 9999px;
    border: 1px solid var(--bd); color: var(--ink); background: var(--card);
  }
  .heat-chip.first { background: var(--heat-700); border-color: var(--heat-700); color: #ffffff; font-weight: 600; }
  .heat-chip .rampdot { display: inline-block; width: 7px; height: 7px; border-radius: 2px; margin-right: 6px; }
  .heat-chip small { color: inherit; opacity: 0.6; margin-right: 5px; font-size: 9px; }

  /* ═══ próximos passos ═══ */
  .reco { display: flex; flex-direction: column; gap: 8px; }
  .reco-card {
    display: grid; grid-template-columns: 46px 1fr auto; gap: 14px; align-items: start;
    background: var(--card); border: 1px solid var(--bd); border-radius: 12px;
    box-shadow: var(--card-shadow); padding: 13px 18px;
  }
  .reco-card .rc-n {
    font-family: var(--font-display); font-size: 21px; font-weight: 500; color: var(--tx3);
    border-right: 1px solid var(--hairline); padding-right: 10px; line-height: 1.2;
  }
  .reco-card .rc-t { font-size: 13.5px; font-weight: 700; margin-bottom: 4px; }
  /* clamp to 2 lines (same technique as .p-caption) — validateAIOutput enforces no
     maximum length on recommendation.description, and the page has room for exactly
     two wrapped lines; without this an unusually long description grows the card,
     the min-height page pushes onto a blank 7th sheet, and the footer follows it. */
  .reco-card .rc-d {
    font-size: 11px; color: var(--tx2); line-height: 1.6; max-width: 122mm;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .prio { font-size: 9px; font-weight: 600; padding: 3.5px 10px; border-radius: 9999px; white-space: nowrap; }
  .prio.alta { background: #F7E8CE; color: #8F5306; }
  .prio.media { background: var(--soft); color: var(--tx2); }
  .prio.baixa { background: transparent; color: var(--tx3); border: 1px solid var(--bd); }

  .goal-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .goal { background: var(--card); border: 1px dashed rgba(28,25,23,0.18); border-radius: 12px; padding: 14px 16px; }
  .goal .g-metric { font-size: 10px; font-weight: 500; color: var(--tx2); }
  .goal .g-target { font-family: var(--font-display); font-size: 25px; font-weight: 500; letter-spacing: -0.02em; margin: 7px 0 5px; }
  .goal .g-why {
    font-size: 10px; color: var(--tx2); line-height: 1.5;
    display: -webkit-box; -webkit-line-clamp: 6; -webkit-box-orient: vertical; overflow: hidden;
  }

  .closing {
    margin-top: auto;
    border-radius: 12px;
    background: var(--ink);
    color: #FAFAF7;
    padding: 19px 24px;
    display: flex; justify-content: space-between; align-items: center;
  }
  .closing .c-t { font-family: var(--font-display); font-size: 17px; font-weight: 600; letter-spacing: -0.01em; }
  .closing .c-d { font-size: 10.5px; color: rgba(250,250,247,0.7); margin-top: 4px; }
  .closing .c-b { font-size: 10.5px; font-weight: 500; text-align: right; line-height: 1.9; color: rgba(250,250,247,0.9); }

  .spacer { flex: 1; }

  /* ═══ camada mobile (Hub em iframe) ═══ */
  @media screen and (max-width: 860px) {
    .page { width: 100%; min-height: 0; padding: 26px 18px 30px; margin-bottom: 8px; }
    .page-footer { display: none; }
    .cover { padding: 0; min-height: 78vh; }
    .cover-top { padding: 26px 20px 0; }
    .cover-mid { padding: 0 20px; }
    .cover-bottom { padding: 0 20px 24px; }
    .cover-handle { font-size: 36px; }
    .cover-teaser { grid-template-columns: 1fr; gap: 12px; }
    .cover-art { margin: 20px 20px 16px; }
    .kpi-grid { grid-template-columns: 1fr 1fr; }
    .hl-grid, .fmt-grid, .aux-grid, .goal-grid { grid-template-columns: 1fr; }
    .toc { grid-template-columns: 1fr 1fr; }
    .post-grid { grid-template-columns: 1fr 1fr; }
    .aud-grid, .loc-grid { grid-template-columns: 1fr; }
    .post-rest .r-row { grid-template-columns: 26px 1fr 62px; }
    .post-rest .r-m.hide-m { display: none; }
    .reco-card { grid-template-columns: 36px 1fr; }
    .reco-card .prio { grid-column: 2; justify-self: start; }
    .closing { flex-direction: column; align-items: flex-start; gap: 12px; }
    .closing .c-b { text-align: left; }
    .heat-scroll { overflow-x: auto; }
    .heat-table { min-width: 520px; }
    /* the 4-column topics table can't compress below ~430px — scroll it inside
       its own card instead of letting the whole page scroll sideways */
    .topics { overflow-x: auto; }
    .topics table { min-width: 420px; }
  }
</style>
</head>
<body>

<!-- ═══════════ PÁGINA 1 · CAPA ═══════════ -->
<div class="page cover">
  <div class="cover-top">
    <div>{{COVER_BRAND}}</div>
    <div class="cover-doc">Relatório mensal<br>Instagram</div>
  </div>
  <div class="cover-mid">{{COVER_MID}}</div>
  {{COVER_ART}}
  <div class="cover-bottom">
    <div class="cover-teaser">{{COVER_TEASER}}</div>
  </div>
</div>

<!-- ═══════════ PÁGINA 2 · RESUMO ═══════════ -->
<div class="page">
  <div class="sec"><h2>Resumo do mês</h2><span class="rule"></span><span class="idx">{{SEC_NO}} / {{SEC_TOTAL}}</span></div>

  {{TAKEAWAY_RESUMO}}

  <div class="summary">{{EXECUTIVE_SUMMARY}}</div>

  <div class="sec"><h2>Métricas principais</h2><span class="rule"></span></div>
  <div class="kpi-grid">{{KPI_CARDS}}</div>

  {{#IF_HAS_HIGHLIGHTS}}<div class="sec"><h2>Destaques</h2><span class="rule"></span></div>
  <div class="hl-grid">{{HIGHLIGHTS}}</div>{{/IF_HAS_HIGHLIGHTS}}

  <div class="sec"><h2>Neste relatório</h2><span class="rule"></span></div>
  <div class="toc">{{TOC_ITEMS}}</div>

  {{FOOTER}}
</div>

<!-- ═══════════ PÁGINA 3 · CRESCIMENTO E FORMATOS ═══════════ -->
<div class="page">
  <div class="sec"><h2>Evolução de seguidores</h2><span class="rule"></span><span class="idx">{{SEC_NO}} / {{SEC_TOTAL}}</span></div>

  {{TAKEAWAY_CRESCIMENTO}}

  <div class="chart-card">{{FOLLOWER_CHART}}</div>

  <div class="sec"><h2>Desempenho por formato</h2><span class="rule"></span></div>

  {{TAKEAWAY_FORMATOS}}

  <div class="fmt-grid">{{FORMAT_CARDS}}</div>

  <div class="sec"><h2>Métricas complementares</h2><span class="rule"></span></div>
  <div class="aux-grid">{{AUX_KPIS}}</div>

  {{FOOTER}}
</div>

<!-- ═══════════ PÁGINA 4 · PUBLICAÇÕES ═══════════ -->
<div class="page">
  <div class="sec"><h2>{{POSTS_HEADING}}</h2><span class="rule"></span><span class="idx">{{SEC_NO}} / {{SEC_TOTAL}}</span></div>

  {{TAKEAWAY_POSTS}}

  <div class="post-grid {{POST_GRID_MOD}}">{{TOP_POST_CARDS}}</div>

  {{#IF_HAS_LIST}}<div class="post-rest">{{POST_LIST_ROWS}}</div>{{/IF_HAS_LIST}}

  {{#IF_HAS_TAGS}}<div class="sec"><h2>{{TAGS_HEADING}}</h2><span class="rule"></span></div>
  <div class="topics">
    <table>
      <thead>
        <tr><th>Tópico</th><th>Posts</th><th>Alcance médio</th><th class="r">Engajamento médio</th></tr>
      </thead>
      <tbody>{{TAGS_TABLE}}</tbody>
    </table>
  </div>{{/IF_HAS_TAGS}}

  {{FOOTER}}
</div>

{{#IF_HAS_AUDIENCE}}<!-- ═══════════ PÁGINA 5 · AUDIÊNCIA ═══════════ -->
<div class="page">
  <div class="sec"><h2>Quem é a sua audiência</h2><span class="rule"></span><span class="idx">{{SEC_NO}} / {{SEC_TOTAL}}</span></div>

  {{TAKEAWAY_AUDIENCIA}}

  <div class="aud-grid">{{DEMOGRAPHICS}}</div>

  <div class="sec"><h2>Localização</h2><span class="rule"></span></div>
  <div class="loc-grid">{{LOCATION}}</div>

  {{#IF_HAS_HEATMAP}}<div class="sec"><h2>Melhores horários para publicar</h2><span class="rule"></span></div>
  <div class="panel">
    <div class="heat-scroll">{{HEATMAP_TABLE}}</div>
    <div class="heat-top">{{HEAT_CHIPS}}</div>
  </div>{{/IF_HAS_HEATMAP}}

  {{FOOTER}}
</div>{{/IF_HAS_AUDIENCE}}

{{#IF_HAS_AI}}<!-- ═══════════ PÁGINA 6 · PRÓXIMOS PASSOS ═══════════ -->
<div class="page">
  {{#IF_HAS_RECOS}}<div class="sec"><h2>Recomendações para {{NEXT_MONTH}}</h2><span class="rule"></span><span class="idx">{{SEC_NO}} / {{SEC_TOTAL}}</span></div>

  {{TAKEAWAY_PLANO}}

  <div class="reco">{{RECO_CARDS}}</div>{{/IF_HAS_RECOS}}

  <div class="sec"><h2>Metas para {{NEXT_MONTH}}</h2><span class="rule"></span></div>
  <div class="goal-grid">{{GOAL_CARDS}}</div>

  <div class="spacer"></div>

  {{CLOSING}}

  {{FOOTER}}
</div>{{/IF_HAS_AI}}

</body>
</html>`;
