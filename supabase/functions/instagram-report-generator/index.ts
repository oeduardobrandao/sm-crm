import { createClient } from "npm:@supabase/supabase-js@2";
import { jsPDF } from "npm:jspdf@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const MONTHS_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace('/instagram-report-generator', '');

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const json = (data: any, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const serviceClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // POST /generate/:clientId?month=YYYY-MM
    if (req.method === 'POST' && path.match(/^\/generate\/\d+$/)) {
      const clientId = path.split('/')[2];
      const month = url.searchParams.get('month') || getPreviousMonth();

      const body = await req.json().catch(() => ({}));
      const reportId = body.reportId;

      // Get client info
      const { data: cliente } = await serviceClient
        .from('clientes')
        .select('*')
        .eq('id', clientId)
        .single();
      if (!cliente) throw new Error("Cliente não encontrado");

      // Get Instagram account
      const { data: account } = await serviceClient
        .from('instagram_accounts')
        .select('*')
        .eq('client_id', clientId)
        .single();
      if (!account) throw new Error("Conta Instagram não encontrada");

      // Get posts for the month
      const [year, monthNum] = month.split('-').map(Number);
      const monthStart = new Date(year, monthNum - 1, 1).toISOString();
      const monthEnd = new Date(year, monthNum, 0, 23, 59, 59).toISOString();

      const { data: posts } = await serviceClient
        .from('instagram_posts')
        .select('*')
        .eq('instagram_account_id', account.id)
        .gte('posted_at', monthStart)
        .lte('posted_at', monthEnd)
        .order('posted_at', { ascending: false });

      const allPosts = posts || [];

      // Get follower history for the month
      const { data: followerHistory } = await serviceClient
        .from('instagram_follower_history')
        .select('date, follower_count')
        .eq('instagram_account_id', account.id)
        .gte('date', monthStart.split('T')[0])
        .lte('date', monthEnd.split('T')[0])
        .order('date', { ascending: true });

      const history = followerHistory || [];

      // Get demographics from cache
      const { data: demoCache } = await serviceClient
        .from('instagram_analytics_cache')
        .select('data')
        .eq('instagram_account_id', account.id)
        .eq('cache_key', 'demographics')
        .single();

      const demographics = demoCache?.data || null;

      // --- Generate PDF (single continuous page) ---
      const pageWidth = 210; // A4 width in mm
      const tallHeight = 5000; // tall enough for any content
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [pageWidth, tallHeight] });
      const margin = 18;
      const contentWidth = pageWidth - margin * 2; // 174
      let y = 0;

      // Design system colors (RGB tuples)
      const C: Record<string, number[]> = {
        dark:     [18,  21,  26 ],
        darkCard: [28,  33,  40 ],
        primary:  [234, 179, 8  ],
        accent:   [255, 158, 33 ], // #FF9E21 — Mesaas brand orange
        success:  [62,  207, 142],
        white:    [255, 255, 255],
        gray50:   [248, 249, 250],
        gray100:  [241, 243, 245],
        gray200:  [222, 226, 230],
        gray400:  [148, 156, 165],
        gray500:  [108, 117, 125],
        gray700:  [73,  80,  87 ],
        gray900:  [33,  37,  41 ],
        accentA:  [42,  130, 245],
      };

      const setFill = (c: number[]) => doc.setFillColor(c[0], c[1], c[2]);
      const setDraw = (c: number[]) => doc.setDrawColor(c[0], c[1], c[2]);
      const setTxt  = (c: number[]) => doc.setTextColor(c[0], c[1], c[2]);

      // Truncate text to fit within maxWidth, adding ellipsis if needed
      const truncText = (text: string, maxWidth: number): string => {
        const lines = doc.splitTextToSize(text, maxWidth) as string[];
        if (lines.length <= 1) return text;
        // Trim first line and add ellipsis
        let truncated = lines[0];
        while (doc.getTextWidth(truncated + '...') > maxWidth && truncated.length > 1) {
          truncated = truncated.slice(0, -1);
        }
        return truncated + '...';
      };

      // Section heading helper
      const sectionHeading = (title: string, subtitle?: string) => {
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        setTxt(C.dark);
        doc.text(title, margin, y);

        // Side accent bar
        setFill(C.primary);
        doc.rect(margin - 4, y - 5, 2, 6, 'F');

        y += 6;
        if (subtitle) {
          doc.setFontSize(10);
          doc.setFont('helvetica', 'normal');
          setTxt(C.gray500);
          doc.text(subtitle, margin, y);
          y += 6;
        }

        doc.setFont('helvetica', 'normal');
        y += 6;
      };

      // ===========================
      // COVER SECTION
      // ===========================
      const coverHeight = 270;

      // Deep dark background
      setFill([13, 17, 23]);
      doc.rect(0, 0, pageWidth, coverHeight, 'F');

      // Decorative concentric circles
      setDraw([28, 33, 40]);
      doc.setLineWidth(0.5);
      for (let i = 0; i < 10; i++) {
        doc.circle(0, 0, 50 + i * 20, 'S');
      }
      for (let i = 0; i < 8; i++) {
        doc.circle(pageWidth, coverHeight, 40 + i * 25, 'S');
      }

      // Top primary border
      setFill(C.primary);
      doc.rect(0, 0, pageWidth, 6, 'F');

      // Left accent bar
      setFill(C.primary);
      doc.rect(0, 60, 4, 80, 'F');

      // Right golden box
      setFill(C.primary);
      doc.rect(pageWidth - 15, 60, 15, 15, 'F');

      // Bottom left geometric squares
      setFill([28, 33, 40]);
      doc.rect(margin, coverHeight - 40, 20, 20, 'F');
      setFill(C.primary);
      doc.rect(margin + 22, coverHeight - 34, 8, 8, 'F');

      // ---- Mesaas Logo (actual desk/bureau icon) ----
      const logoX = margin;
      const logoY = 55;
      drawMesaasLogo(doc, logoX, logoY, 28, setFill, setDraw, C.accent);

      // Brand name
      doc.setFontSize(32);
      doc.setFont('helvetica', 'bold');
      setTxt(C.white);
      doc.text('Mesaas', logoX + 36, logoY + 18);

      // Report Title
      doc.setFontSize(14);
      doc.setFont('helvetica', 'normal');
      setTxt(C.primary);
      doc.text('SOCIAL MEDIA PERFORMANCE', margin, 120);

      doc.setFontSize(48);
      doc.setFont('helvetica', 'bold');
      setTxt(C.white);
      doc.text('Instagram', margin, 138);

      doc.setFontSize(38);
      setTxt(C.gray400);
      doc.text('Relatório', margin, 153);

      // Divider
      setFill(C.gray700);
      doc.rect(margin, 168, 80, 1, 'F');

      // Client info block
      const clientCardW = pageWidth - margin * 2;
      const clientCardHalfW = clientCardW / 2 - 20;
      setFill(C.darkCard);
      doc.roundedRect(margin, 180, clientCardW, 45, 4, 4, 'F');
      setFill(C.primary);
      doc.rect(margin, 180, 4, 45, 'F');

      doc.setFontSize(12);
      doc.setFont('helvetica', 'normal');
      setTxt(C.gray400);
      doc.text('CLIENTE', margin + 15, 195);
      doc.text('PERÍODO', pageWidth / 2 + 10, 195);

      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      setTxt(C.white);
      doc.text(truncText(cliente.nome, clientCardHalfW), margin + 15, 205);
      doc.text(`${MONTHS_PT[monthNum - 1]} ${year}`, pageWidth / 2 + 10, 205);

      doc.setFontSize(12);
      doc.setFont('helvetica', 'normal');
      setTxt(C.primary);
      doc.text(truncText(`@${account.username}`, clientCardHalfW), margin + 15, 215);

      // Bottom footer on cover
      doc.setFontSize(8);
      setTxt(C.gray500);
      doc.text('Gerado automaticamente por Mesaas • mesaas.com.br', pageWidth / 2, coverHeight - 15, { align: 'center' });

      // ===========================
      // CONTENT AREA (starts after cover)
      // ===========================
      y = coverHeight + 8;

      // Content header strip
      setFill(C.primary);
      doc.rect(0, coverHeight, pageWidth, 3, 'F');
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      setTxt(C.gray500);
      doc.text('RELATÓRIO DE INSTAGRAM', margin, coverHeight + 10);
      setTxt(C.gray400);
      doc.text('MESAAS', pageWidth - margin, coverHeight + 10, { align: 'right' });
      setFill(C.gray200);
      doc.rect(margin, coverHeight + 13, contentWidth, 0.3, 'F');

      y = coverHeight + 20;

      // ---- Calculate stats ----
      const totalPosts = allPosts.length;
      const totalReach = allPosts.reduce((s: number, p: any) => s + (p.reach || 0), 0);
      const totalLikes = allPosts.reduce((s: number, p: any) => s + (p.likes || 0), 0);
      const totalComments = allPosts.reduce((s: number, p: any) => s + (p.comments || 0), 0);
      const totalSaved = allPosts.reduce((s: number, p: any) => s + (p.saved || 0), 0);
      const totalShares = allPosts.reduce((s: number, p: any) => s + (p.shares || 0), 0);
      const totalInteractions = totalLikes + totalComments + totalSaved + totalShares;
      const avgEngagement = totalReach > 0 ? (totalInteractions / totalReach) * 100 : 0;
      const savesRate = totalReach > 0 ? (totalSaved / totalReach) * 100 : 0;

      const followerGain = history.length >= 2
        ? history[history.length - 1].follower_count - history[0].follower_count
        : 0;
      const followerGainPct = history.length >= 2 && history[0].follower_count > 0
        ? (followerGain / history[0].follower_count) * 100
        : 0;

      // ---- Executive Summary ----
      sectionHeading('Resumo Executivo', 'Visão geral da sua performance no período');

      const bullets = [
        `O perfil @${account.username} publicou ${totalPosts} conteúdo${totalPosts !== 1 ? 's' : ''} em ${MONTHS_PT[monthNum - 1]}.`,
        followerGain >= 0
          ? `Ganho de ${followerGain.toLocaleString('pt-BR')} seguidores no período (${followerGainPct > 0 ? '+' : ''}${followerGainPct.toFixed(1)}% de crescimento).`
          : `Perda de ${Math.abs(followerGain).toLocaleString('pt-BR')} seguidores no período (${followerGainPct.toFixed(1)}%).`,
        `Alcance total de ${totalReach.toLocaleString('pt-BR')} pessoas no mês.`,
        `Taxa média de engajamento de ${avgEngagement.toFixed(2)}%, com ${totalSaved} salvamentos.`,
      ];

      // Calculate actual height needed for bullets box
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      let bulletsHeight = 0;
      for (const b of bullets) {
        const lines = doc.splitTextToSize(b, contentWidth - 18) as string[];
        bulletsHeight += lines.length * 6 + 2;
      }
      bulletsHeight += 6;

      setFill(C.gray50);
      doc.roundedRect(margin, y - 2, contentWidth, bulletsHeight, 4, 4, 'F');
      setFill(C.primary);
      doc.rect(margin, y - 2, 4, bulletsHeight, 'F');

      for (const b of bullets) {
        setTxt(C.gray700);
        setFill(C.primary);
        doc.circle(margin + 10, y + 2, 1.2, 'F');

        const lines = doc.splitTextToSize(b, contentWidth - 18) as string[];
        doc.text(lines, margin + 14, y + 3);
        y += lines.length * 6 + 2;
      }
      y += 12;

      // ---- KPI Cards ----
      sectionHeading('Métricas do Mês', 'Principais indicadores do Instagram');

      const kpis = [
        { label: 'Seguidores Ganh.', value: `${followerGain >= 0 ? '+' : ''}${followerGain.toLocaleString('pt-BR')}`, color: followerGain >= 0 ? C.success : [245, 90, 66] },
        { label: 'Taxa de Engaj.',       value: `${avgEngagement.toFixed(2)}%`,                                            color: C.primary },
        { label: 'Alcance Total',        value: totalReach.toLocaleString('pt-BR'),                                        color: C.dark },
        { label: 'Contas Engajadas',     value: (account.profile_views_28d || 0).toLocaleString('pt-BR'),                  color: [59, 130, 246] },
        { label: 'Cliques no Link',      value: (account.website_clicks_28d || 0).toLocaleString('pt-BR'),                 color: [168, 85, 247] },
        { label: 'Taxa de Salvos',       value: `${savesRate.toFixed(2)}%`,                                                color: C.primary },
        { label: 'Publicações',          value: String(totalPosts),                                                        color: C.gray500 },
      ];

      const colWidth = (contentWidth - 10) / 3;
      const cardH = 28;
      for (let i = 0; i < kpis.length; i++) {
        const col = i % 3;
        const row = Math.floor(i / 3);
        const x = margin + col * (colWidth + 5);
        const cardY = y + row * (cardH + 5);

        setFill(C.white);
        setDraw(C.gray200);
        doc.setLineWidth(0.3);
        doc.roundedRect(x, cardY, colWidth, cardH, 4, 4, 'FD');

        setFill(kpis[i].color);
        doc.circle(x + 5, cardY + 7, 1.5, 'F');

        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        setTxt(C.gray500);
        doc.text(kpis[i].label.toUpperCase(), x + 9, cardY + 8.5);

        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        setTxt(C.dark);
        // Truncate KPI value to fit card
        doc.text(truncText(kpis[i].value, colWidth - 10), x + 5, cardY + 20);
      }
      y += (Math.ceil(kpis.length / 3)) * (cardH + 5) + 8;

      // ===========================
      // TOP 3 POSTS
      // ===========================
      sectionHeading('Top 3 Publicações', 'Os conteúdos que geraram mais engajamento');

      const top3 = [...allPosts]
        .sort((a: any, b: any) => {
          const engA = a.reach > 0 ? ((a.likes + a.comments + a.saved + a.shares) / a.reach) * 100 : 0;
          const engB = b.reach > 0 ? ((b.likes + b.comments + b.saved + b.shares) / b.reach) * 100 : 0;
          return engB - engA;
        })
        .slice(0, 3);

      for (let i = 0; i < top3.length; i++) {
        const p = top3[i];
        const eng = p.reach > 0 ? ((p.likes + p.comments + p.saved + p.shares) / p.reach) * 100 : 0;
        const date = new Date(p.posted_at).toLocaleDateString('pt-BR');
        const type = p.media_type === 'VIDEO' ? 'Reel' : p.media_type === 'CAROUSEL_ALBUM' ? 'Carrossel' : 'Imagem';
        const caption = (p.caption || 'Sem legenda').replace(/\n/g, ' ');
        const captionLines = doc.splitTextToSize(caption, contentWidth - 36) as string[];
        const captionClipped = captionLines.slice(0, 2);

        let reason = '';
        if (p.saved > totalSaved / (totalPosts || 1) * 2) reason = 'Alto salvamento';
        else if (eng > avgEngagement * 1.5) reason = 'Alto engajamento';
        else if (p.reach > totalReach / (totalPosts || 1) * 1.5) reason = 'Grande alcance';
        else reason = 'Bom desempenho geral';

        const cardHeight = 32;

        // Card background
        setFill(C.white);
        setDraw(C.gray200);
        doc.setLineWidth(0.3);
        doc.roundedRect(margin, y, contentWidth, cardHeight, 4, 4, 'FD');

        // Number Badge
        const accentColors = [C.primary, [99, 102, 241], [16, 185, 129]];
        setFill(accentColors[i]);
        doc.path([
          {op: 'm', c: [margin, y + 4]},
          {op: 'l', c: [margin + 6, y + 4]},
          {op: 'l', c: [margin + 6, y + 14]},
          {op: 'l', c: [margin, y + 14]},
          {op: 'h'}
        ]);
        doc.fill();

        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        setTxt(C.dark);
        doc.text(String(i + 1), margin + 1.5, y + 10.5);

        // Thumbnail placeholder
        setFill(C.gray50);
        doc.roundedRect(margin + 10, y + 6, 20, 20, 2, 2, 'F');
        doc.setFontSize(6);
        setTxt(C.gray400);
        doc.text(type.toUpperCase(), margin + 20, y + 17, { align: 'center' });

        // Title and Date
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        setTxt(C.dark);
        doc.text(date, margin + 35, y + 11);

        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        setTxt(C.gray500);
        doc.text(captionClipped, margin + 35, y + 16);

        // Metrics pills
        const pillY = y + 23;
        const metrics = [
          { l: 'Alcance:', v: `${(p.reach || 0).toLocaleString('pt-BR')}` },
          { l: 'Eng:', v: `${eng.toFixed(1)}%` },
          { l: 'Salvos:', v: `${p.saved || 0}` }
        ];

        let pillX = margin + 35;
        doc.setFontSize(7);
        for (const m of metrics) {
          setFill(C.gray50);
          doc.roundedRect(pillX, pillY - 4, 30, 7, 3, 3, 'F');

          doc.setFont('helvetica', 'normal');
          setTxt(C.gray500);
          doc.text(m.l, pillX + 3, pillY + 1);

          doc.setFont('helvetica', 'bold');
          setTxt(C.dark);
          doc.text(truncText(String(m.v), 12), pillX + 16, pillY + 1);

          pillX += 34;
        }

        // Reason badge (right side)
        setFill([236, 253, 245]);
        doc.roundedRect(margin + contentWidth - 30, y + 6, 25, 6, 2, 2, 'F');
        doc.setFontSize(6);
        doc.setFont('helvetica', 'bold');
        setTxt([5, 150, 105]);
        doc.text(reason, margin + contentWidth - 17, y + 10, { align: 'center' });

        y += cardHeight + 6;
      }

      // ===========================
      // CONTENT TYPE PERFORMANCE
      // ===========================
      y += 4;
      sectionHeading('Desempenho por Tipo de Conteúdo', 'Comparativo entre Reels, Carrosséis e Imagens');

      const typeMap: Record<string, { count: number; totalEng: number; totalReach: number }> = {};
      for (const p of allPosts) {
        const type = p.media_type === 'VIDEO' ? 'Reel' : p.media_type === 'CAROUSEL_ALBUM' ? 'Carrossel' : 'Imagem';
        if (!typeMap[type]) typeMap[type] = { count: 0, totalEng: 0, totalReach: 0 };
        typeMap[type].count++;
        typeMap[type].totalReach += p.reach || 0;
        const eng = p.reach > 0 ? ((p.likes + p.comments + p.saved + p.shares) / p.reach) * 100 : 0;
        typeMap[type].totalEng += eng;
      }

      const typeEntries = Object.entries(typeMap);
      const tableRows = typeEntries.length;
      const tableH = 9 + tableRows * 9;

      setFill(C.white);
      setDraw(C.gray200);
      doc.setLineWidth(0.3);
      doc.roundedRect(margin, y, contentWidth, tableH + 2, 4, 4, 'FD');

      // Table header
      setFill(C.gray50);
      doc.roundedRect(margin, y, contentWidth, 9, 4, 4, 'F');
      doc.rect(margin, y + 4, contentWidth, 5, 'F');

      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'bold');
      setTxt(C.gray700);
      const cols = [margin + 5, margin + 55, margin + 90, margin + 130];
      doc.text('TIPO DE CONTEÚDO', cols[0], y + 6.5);
      doc.text('QUANTIDADE',       cols[1], y + 6.5);
      doc.text('ENG. MÉDIO',       cols[2], y + 6.5);
      doc.text('ALCANCE MÉDIO',    cols[3], y + 6.5);
      y += 10;

      doc.setFont('helvetica', 'normal');
      let rowIdx = 0;
      for (const [type, data] of typeEntries) {
        const avgEng   = data.count > 0 ? data.totalEng / data.count : 0;
        const avgReach = data.count > 0 ? Math.round(data.totalReach / data.count) : 0;

        if (rowIdx % 2 === 0) {
          setFill(C.gray50);
          doc.rect(margin, y - 1, contentWidth, 9, 'F');
        } else {
          setFill(C.white);
          doc.rect(margin, y - 1, contentWidth, 9, 'F');
        }

        doc.setFontSize(9);
        setTxt(C.dark);
        doc.text(type,                                                cols[0], y + 5);
        doc.text(String(data.count),                                  cols[1], y + 5);
        doc.text(`${avgEng.toFixed(2)}%`,                             cols[2], y + 5);
        doc.text(truncText(avgReach.toLocaleString('pt-BR'), 35),     cols[3], y + 5);
        y += 9;
        rowIdx++;
      }
      y += 6;

      // ===========================
      // DEMOGRAPHICS
      // ===========================
      if (demographics) {
        sectionHeading('Audiência', 'Distribuição demográfica e geografia');

        if (demographics.gender_split) {
          const female = demographics.gender_split.female || 0;
          const male   = demographics.gender_split.male   || 0;
          const barW   = contentWidth;
          const barH   = 8;

          setFill(C.primary);
          doc.roundedRect(margin, y, barW * (female / 100), barH, 2, 2, 'F');
          doc.rect(margin + barW * (female / 100) - 3, y, 3, barH, 'F');

          setFill([99, 102, 241]);
          doc.roundedRect(margin + barW * (female / 100), y, barW * (male / 100), barH, 2, 2, 'F');
          doc.rect(margin + barW * (female / 100), y, 3, barH, 'F');

          y += barH + 4;

          doc.setFontSize(8.5);
          doc.setFont('helvetica', 'normal');
          setTxt(C.primary);
          doc.text(`${female}% Feminino`, margin, y);
          setTxt([99, 102, 241]);
          doc.text(`${male}% Masculino`, margin + 40, y);
          y += 8;
        }

        if (demographics.cities?.length > 0) {
          doc.setFontSize(9);
          doc.setFont('helvetica', 'bold');
          setTxt(C.gray700);
          doc.text('Principais Cidades', margin, y);
          y += 6;

          const cities = demographics.cities.slice(0, 5);
          const maxCount = cities[0]?.count || 1;

          for (const c of cities) {
            const barWidth = (c.count / maxCount) * (contentWidth - 55);
            setFill(C.gray100);
            doc.roundedRect(margin, y - 1, contentWidth - 55, 7, 2, 2, 'F');
            setFill(C.primary);
            doc.roundedRect(margin, y - 1, barWidth, 7, 2, 2, 'F');

            doc.setFontSize(8);
            doc.setFont('helvetica', 'normal');
            setTxt(C.gray900);
            doc.text(truncText(c.name, 42), margin + contentWidth - 50, y + 4);
            setTxt(C.gray500);
            doc.text(`${c.count.toLocaleString('pt-BR')}`, margin + contentWidth - 5, y + 4, { align: 'right' });
            y += 9;
          }
          y += 4;
        }
      }

      // ===========================
      // RECOMMENDATIONS
      // ===========================
      sectionHeading('Recomendações para o Próximo Mês', 'Próximos passos estratégicos');

      const recommendations = generateRecommendations(allPosts, typeMap, avgEngagement, savesRate, followerGain);
      const recColors = [C.primary, [16, 185, 129], [99, 102, 241]];

      for (let i = 0; i < recommendations.length; i++) {
        const recLines = doc.splitTextToSize(recommendations[i], contentWidth - 20) as string[];
        const recCardH = Math.max(20, recLines.length * 5.5 + 12);

        setFill(C.white);
        setDraw(C.gray200);
        doc.setLineWidth(0.3);
        doc.roundedRect(margin, y, contentWidth, recCardH, 4, 4, 'FD');

        // Left color accent bar
        setFill(recColors[i % 3] || C.primary);
        doc.path([
          {op: 'm', c: [margin, y + 4]},
          {op: 'l', c: [margin + 4, y + 4]},
          {op: 'l', c: [margin + 4, y + recCardH - 4]},
          {op: 'l', c: [margin, y + recCardH - 4]},
          {op: 'h'}
        ]);
        doc.fill();

        // Icon/Number circle
        setFill(C.gray50);
        doc.circle(margin + 12, y + recCardH / 2, 6, 'F');
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        setTxt(recColors[i % 3] || C.primary);
        doc.text(String(i + 1), margin + 12, y + recCardH / 2 + 2.5, { align: 'center' });

        // Text
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        setTxt(C.dark);
        const textY = y + (recCardH - recLines.length * 5.5) / 2 + 4.5;
        doc.text(recLines, margin + 22, textY);

        y += recCardH + 5;
      }

      // ===========================
      // Final footer
      // ===========================
      y += 6;
      setFill(C.gray50);
      doc.roundedRect(margin, y, contentWidth, 12, 2, 2, 'F');
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'normal');
      setTxt(C.gray400);
      doc.text(
        `Relatório de ${MONTHS_PT[monthNum - 1]} ${year} gerado por Mesaas em ${new Date().toLocaleDateString('pt-BR')}`,
        pageWidth / 2, y + 7.5, { align: 'center' }
      );
      y += 18;

      // Trim the page to actual content height
      const finalHeight = y + 10;
      const pages = doc.internal.pages;
      // jsPDF stores page dimensions in internal.pageSize
      (doc.internal.pageSize as any).setHeight(finalHeight);

      // --- Save PDF ---
      const pdfBytes = doc.output('arraybuffer');
      const storagePath = `reports/${cliente.conta_id}/${clientId}/${month}.pdf`;

      const { error: uploadError } = await serviceClient.storage
        .from('analytics-reports')
        .upload(storagePath, pdfBytes, {
          contentType: 'application/pdf',
          upsert: true,
        });

      if (uploadError) {
        console.error('Upload error:', uploadError);
        await serviceClient.storage.createBucket('analytics-reports', { public: false });
        const { error: retryError } = await serviceClient.storage
          .from('analytics-reports')
          .upload(storagePath, pdfBytes, {
            contentType: 'application/pdf',
            upsert: true,
          });
        if (retryError) throw new Error('Erro ao salvar PDF: ' + retryError.message);
      }

      const { data: signedUrl } = await serviceClient.storage
        .from('analytics-reports')
        .createSignedUrl(storagePath, 7 * 24 * 60 * 60);

      const reportUrl = signedUrl?.signedUrl || '';

      if (reportId) {
        await serviceClient.from('analytics_reports').update({
          status: 'ready',
          report_url: reportUrl,
          storage_path: storagePath,
          generated_at: new Date().toISOString(),
        }).eq('id', reportId);
      }

      return json({ success: true, report_url: reportUrl });
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });

  } catch (err: any) {
    console.error('Report generation error:', err);
    return json({ error: true, message: err.message || 'Erro ao gerar relatório' }, 500);
  }
});

/**
 * Draws the Mesaas desk/bureau logo icon using jsPDF primitives.
 * Translated from public/mesaas-icon.svg (viewBox 0 0 512 512).
 */
function drawMesaasLogo(
  doc: jsPDF,
  ox: number, oy: number, sizeMM: number,
  setFill: (c: number[]) => void,
  setDraw: (c: number[]) => void,
  color: number[]
) {
  const s = sizeMM / 512;

  setFill(color);
  setDraw(color);

  // Shape 1: Left drawer (rounded rect)
  doc.roundedRect(ox + 171.253 * s, oy + 268.169 * s, 73.69 * s, 30.27 * s, 6.58 * s, 6.58 * s, 'F');

  // Shape 2: Right drawer (rounded rect)
  doc.roundedRect(ox + 264.681 * s, oy + 268.169 * s, 73.69 * s, 30.27 * s, 6.58 * s, 6.58 * s, 'F');

  // Shape 3: Desk body (U-shape stroke)
  // SVG: M133.092 323.437 V243.44 H375.453 V323.437 (stroke, no fill)
  const strokeW = 26.0731 * s;
  doc.setLineWidth(strokeW);
  doc.setLineCap('square');
  doc.setLineJoin('miter');

  const ux1 = ox + 133.092 * s;
  const ux2 = ox + 375.453 * s;
  const uyTop = oy + 243.44 * s;
  const uyBot = oy + 323.437 * s;

  doc.line(ux1, uyBot, ux1, uyTop);
  doc.line(ux1, uyTop, ux2, uyTop);
  doc.line(ux2, uyTop, ux2, uyBot);

  doc.setLineWidth(0.5);
  doc.setLineCap('butt');

  // Shape 4: Left chimney (trapezoid with rounded top)
  // Approximated as a filled polygon (simplified from bezier paths)
  const lc = {
    topLeft: { x: 180.831, y: 218.166 },
    topRight: { x: 235.598, y: 218.166 },
    bottomRight: { x: 153.052, y: 218.166 }, // approximate curve end
    // The chimney is essentially a trapezoid narrower at top
    innerTopLeft: { x: 123.405, y: 218.166 },
    bottomLeft: { x: 122.333, y: 193.241 },
  };
  // Simplified: draw as a filled rect with rounded top representing the chimney shape
  // Left chimney: roughly x=120..153, y=181..218, wider at bottom
  doc.path([
    { op: 'm', c: [ox + 129.042 * s, oy + 181.321 * s] },   // bottom-left of chimney base
    { op: 'l', c: [ox + 144.503 * s, oy + 181.321 * s] },   // bottom-right of chimney base
    { op: 'l', c: [ox + 153.052 * s, oy + 211.531 * s] },   // top-right (wider)
    { op: 'l', c: [ox + 235.598 * s, oy + 218.166 * s] },   // top outer right
    { op: 'l', c: [ox + 180.831 * s, oy + 218.166 * s] },   // top outer left
    { op: 'l', c: [ox + 120.621 * s, oy + 211.339 * s] },   // top-left (wider)
    { op: 'h' }
  ]);
  doc.fill();

  // Right chimney: same shape shifted right
  doc.path([
    { op: 'm', c: [ox + 285.758 * s, oy + 181.321 * s] },
    { op: 'l', c: [ox + 317.293 * s, oy + 181.321 * s] },
    { op: 'l', c: [ox + 334.731 * s, oy + 211.531 * s] },
    { op: 'l', c: [ox + 329.026 * s, oy + 218.166 * s] },
    { op: 'l', c: [ox + 274.259 * s, oy + 218.166 * s] },
    { op: 'l', c: [ox + 268.581 * s, oy + 211.339 * s] },
    { op: 'h' }
  ]);
  doc.fill();
}

function getPreviousMonth(): string {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
}

function generateRecommendations(
  posts: any[],
  typeMap: Record<string, { count: number; totalEng: number; totalReach: number }>,
  avgEngagement: number,
  savesRate: number,
  followerGain: number
): string[] {
  const recs: string[] = [];

  const types = Object.entries(typeMap).map(([type, data]) => ({
    type,
    avgEng: data.count > 0 ? data.totalEng / data.count : 0,
    count: data.count,
  })).sort((a, b) => b.avgEng - a.avgEng);

  if (types.length >= 2 && types[0].avgEng > types[1].avgEng * 1.3) {
    recs.push(`${types[0].type}s tiveram o melhor engajamento (${types[0].avgEng.toFixed(1)}%). Considere publicar mais conteúdo nesse formato.`);
  }

  if (savesRate < 1) {
    recs.push('A taxa de salvamentos está abaixo de 1%. Invista em conteúdo educativo e informativo que os seguidores queiram guardar para consulta futura.');
  } else if (savesRate >= 3) {
    recs.push(`Excelente taxa de salvamentos (${savesRate.toFixed(1)}%)! Continue produzindo conteúdo educativo e útil.`);
  }

  if (posts.length < 8) {
    recs.push(`Apenas ${posts.length} publicações no mês. Busque manter uma frequência de pelo menos 3 posts por semana para manter o algoritmo engajado.`);
  }

  if (avgEngagement < 2) {
    recs.push('O engajamento está abaixo de 2%. Experimente CTAs (chamadas para ação) mais diretas nas legendas e use formatos interativos como enquetes nos Stories.');
  }

  if (followerGain <= 0) {
    recs.push('O perfil não cresceu em seguidores este mês. Considere estratégias de colaboração com outros perfis da área e conteúdo viral (Reels curtos e informativos).');
  }

  if (recs.length === 0) {
    recs.push('Continue mantendo a consistência de publicações e o nível de engajamento atual.');
    recs.push('Teste novos formatos de conteúdo para identificar oportunidades de crescimento.');
    recs.push('Monitore as métricas semanalmente para ajustes rápidos na estratégia.');
  }

  return recs.slice(0, 3);
}
