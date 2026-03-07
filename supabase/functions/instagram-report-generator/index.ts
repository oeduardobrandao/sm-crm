import { createClient } from "npm:@supabase/supabase-js@2";
import { jsPDF } from "npm:jspdf@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const MONTHS_PT = ['Janeiro', 'Fevereiro', 'Marco', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

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
      if (!cliente) throw new Error("Cliente nao encontrado");

      // Get Instagram account
      const { data: account } = await serviceClient
        .from('instagram_accounts')
        .select('*')
        .eq('client_id', clientId)
        .single();
      if (!account) throw new Error("Conta Instagram nao encontrada");

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

      // --- Generate PDF ---
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 20;
      const contentWidth = pageWidth - margin * 2;
      let y = 0;

      // Helper functions
      const addPage = () => { doc.addPage(); y = margin; };
      const checkPageBreak = (needed: number) => { if (y + needed > 270) addPage(); };

      // === PAGE 1: Cover ===
      doc.setFillColor(18, 21, 26); // --dark
      doc.rect(0, 0, pageWidth, 297, 'F');

      doc.setTextColor(200, 245, 66); // --primary
      doc.setFontSize(32);
      doc.text('Mesaas', pageWidth / 2, 80, { align: 'center' });

      doc.setTextColor(255, 255, 255);
      doc.setFontSize(18);
      doc.text('Relatorio de Performance', pageWidth / 2, 110, { align: 'center' });
      doc.text('Instagram', pageWidth / 2, 122, { align: 'center' });

      doc.setFontSize(14);
      doc.text(cliente.nome, pageWidth / 2, 150, { align: 'center' });

      doc.setFontSize(12);
      doc.setTextColor(180, 180, 180);
      doc.text(`@${account.username}`, pageWidth / 2, 162, { align: 'center' });
      doc.text(`${MONTHS_PT[monthNum - 1]} ${year}`, pageWidth / 2, 176, { align: 'center' });

      doc.setFontSize(9);
      doc.setTextColor(100, 100, 100);
      doc.text('Gerado automaticamente por Mesaas', pageWidth / 2, 270, { align: 'center' });

      // === PAGE 2: Executive Summary + KPIs ===
      addPage();
      doc.setTextColor(50, 50, 50);

      // Title
      doc.setFontSize(16);
      doc.setTextColor(200, 245, 66);
      doc.text('Resumo Executivo', margin, y);
      y += 10;

      doc.setTextColor(60, 60, 60);
      doc.setFontSize(10);

      // Calculate stats
      const totalPosts = allPosts.length;
      const totalReach = allPosts.reduce((s, p) => s + (p.reach || 0), 0);
      const totalImpressions = allPosts.reduce((s, p) => s + (p.impressions || 0), 0);
      const totalLikes = allPosts.reduce((s, p) => s + (p.likes || 0), 0);
      const totalComments = allPosts.reduce((s, p) => s + (p.comments || 0), 0);
      const totalSaved = allPosts.reduce((s, p) => s + (p.saved || 0), 0);
      const totalShares = allPosts.reduce((s, p) => s + (p.shares || 0), 0);
      const totalInteractions = totalLikes + totalComments + totalSaved + totalShares;
      const avgEngagement = totalReach > 0 ? (totalInteractions / totalReach) * 100 : 0;
      const savesRate = totalReach > 0 ? (totalSaved / totalReach) * 100 : 0;

      const followerGain = history.length >= 2
        ? history[history.length - 1].follower_count - history[0].follower_count
        : 0;
      const followerGainPct = history.length >= 2 && history[0].follower_count > 0
        ? (followerGain / history[0].follower_count) * 100
        : 0;

      // Bullet points
      const bullets = [
        `O perfil @${account.username} publicou ${totalPosts} conteudo${totalPosts !== 1 ? 's' : ''} em ${MONTHS_PT[monthNum - 1]}.`,
        followerGain >= 0
          ? `O perfil ganhou ${followerGain.toLocaleString('pt-BR')} seguidores (${followerGainPct > 0 ? '+' : ''}${followerGainPct.toFixed(1)}% de crescimento).`
          : `O perfil perdeu ${Math.abs(followerGain).toLocaleString('pt-BR')} seguidores (${followerGainPct.toFixed(1)}%).`,
        `O alcance total no periodo foi de ${totalReach.toLocaleString('pt-BR')} pessoas.`,
        `A taxa media de engajamento foi de ${avgEngagement.toFixed(2)}%, com ${totalSaved} salvamentos no total.`,
      ];

      for (const b of bullets) {
        doc.text(`•  ${b}`, margin, y);
        y += 6;
      }

      y += 10;

      // KPI Grid
      doc.setFontSize(16);
      doc.setTextColor(200, 245, 66);
      doc.text('Metricas do Mes', margin, y);
      y += 10;

      const kpis = [
        { label: 'Seguidores', value: `${followerGain >= 0 ? '+' : ''}${followerGain.toLocaleString('pt-BR')}` },
        { label: 'Engajamento', value: `${avgEngagement.toFixed(2)}%` },
        { label: 'Alcance Total', value: totalReach.toLocaleString('pt-BR') },
        { label: 'Visitas ao Perfil', value: (account.profile_views_28d || 0).toLocaleString('pt-BR') },
        { label: 'Taxa de Salvamentos', value: `${savesRate.toFixed(2)}%` },
        { label: 'Posts Publicados', value: String(totalPosts) },
      ];

      const colWidth = contentWidth / 3;
      for (let i = 0; i < kpis.length; i++) {
        const col = i % 3;
        const x = margin + col * colWidth;

        if (i > 0 && col === 0) y += 20;

        doc.setFillColor(245, 245, 245);
        doc.roundedRect(x, y, colWidth - 4, 18, 3, 3, 'F');

        doc.setFontSize(7);
        doc.setTextColor(120, 120, 120);
        doc.text(kpis[i].label.toUpperCase(), x + 4, y + 5);

        doc.setFontSize(13);
        doc.setTextColor(30, 30, 30);
        doc.text(kpis[i].value, x + 4, y + 14);
      }
      y += 30;

      // === TOP 3 POSTS ===
      checkPageBreak(80);
      doc.setFontSize(16);
      doc.setTextColor(200, 245, 66);
      doc.text('Top 3 Publicacoes', margin, y);
      y += 10;

      const top3 = [...allPosts]
        .sort((a, b) => {
          const engA = a.reach > 0 ? ((a.likes + a.comments + a.saved + a.shares) / a.reach) * 100 : 0;
          const engB = b.reach > 0 ? ((b.likes + b.comments + b.saved + b.shares) / b.reach) * 100 : 0;
          return engB - engA;
        })
        .slice(0, 3);

      for (let i = 0; i < top3.length; i++) {
        checkPageBreak(30);
        const p = top3[i];
        const eng = p.reach > 0 ? ((p.likes + p.comments + p.saved + p.shares) / p.reach) * 100 : 0;
        const date = new Date(p.posted_at).toLocaleDateString('pt-BR');
        const type = p.media_type === 'VIDEO' ? 'Reel' : p.media_type === 'CAROUSEL_ALBUM' ? 'Carrossel' : 'Imagem';

        doc.setFillColor(250, 250, 250);
        doc.roundedRect(margin, y, contentWidth, 24, 3, 3, 'F');

        doc.setFontSize(10);
        doc.setTextColor(60, 60, 60);
        doc.text(`${i + 1}. ${type} - ${date}`, margin + 4, y + 6);

        doc.setFontSize(8);
        doc.setTextColor(100, 100, 100);
        const caption = (p.caption || 'Sem legenda').slice(0, 80) + ((p.caption || '').length > 80 ? '...' : '');
        doc.text(caption, margin + 4, y + 12);

        const metrics = `Alcance: ${p.reach.toLocaleString('pt-BR')} | Eng: ${eng.toFixed(1)}% | Salvos: ${p.saved} | Coment: ${p.comments}`;
        doc.text(metrics, margin + 4, y + 18);

        // Why it performed well
        let reason = '';
        if (p.saved > totalSaved / (totalPosts || 1) * 2) reason = 'Alto numero de salvamentos indica conteudo util.';
        else if (eng > avgEngagement * 1.5) reason = 'Engajamento acima da media do perfil.';
        else if (p.reach > totalReach / (totalPosts || 1) * 1.5) reason = 'Alcance significativamente acima da media.';
        else reason = 'Bom desempenho geral nas metricas.';

        doc.setTextColor(62, 207, 142);
        doc.text(`→ ${reason}`, margin + 4, y + 23);

        y += 28;
      }

      // === CONTENT TYPE PERFORMANCE ===
      checkPageBreak(50);
      y += 5;
      doc.setFontSize(16);
      doc.setTextColor(200, 245, 66);
      doc.text('Desempenho por Tipo de Conteudo', margin, y);
      y += 10;

      const typeMap: Record<string, { count: number; totalEng: number; totalReach: number }> = {};
      for (const p of allPosts) {
        const type = p.media_type === 'VIDEO' ? 'Reel' : p.media_type === 'CAROUSEL_ALBUM' ? 'Carrossel' : 'Imagem';
        if (!typeMap[type]) typeMap[type] = { count: 0, totalEng: 0, totalReach: 0 };
        typeMap[type].count++;
        typeMap[type].totalReach += p.reach || 0;
        const eng = p.reach > 0 ? ((p.likes + p.comments + p.saved + p.shares) / p.reach) * 100 : 0;
        typeMap[type].totalEng += eng;
      }

      // Table header
      doc.setFillColor(230, 230, 230);
      doc.rect(margin, y, contentWidth, 7, 'F');
      doc.setFontSize(8);
      doc.setTextColor(80, 80, 80);
      doc.text('Tipo', margin + 4, y + 5);
      doc.text('Qtd', margin + 50, y + 5);
      doc.text('Eng. Medio', margin + 80, y + 5);
      doc.text('Alcance Medio', margin + 120, y + 5);
      y += 9;

      doc.setTextColor(60, 60, 60);
      for (const [type, data] of Object.entries(typeMap)) {
        const avgEng = data.count > 0 ? data.totalEng / data.count : 0;
        const avgReach = data.count > 0 ? Math.round(data.totalReach / data.count) : 0;
        doc.text(type, margin + 4, y + 4);
        doc.text(String(data.count), margin + 50, y + 4);
        doc.text(`${avgEng.toFixed(2)}%`, margin + 80, y + 4);
        doc.text(avgReach.toLocaleString('pt-BR'), margin + 120, y + 4);
        y += 7;
      }

      // === DEMOGRAPHICS (if available) ===
      if (demographics) {
        checkPageBreak(60);
        y += 10;
        doc.setFontSize(16);
        doc.setTextColor(200, 245, 66);
        doc.text('Audiencia', margin, y);
        y += 10;

        doc.setFontSize(9);
        doc.setTextColor(60, 60, 60);

        if (demographics.gender_split) {
          doc.text(`Genero: ${demographics.gender_split.female}% Feminino | ${demographics.gender_split.male}% Masculino`, margin, y);
          y += 7;
        }

        if (demographics.cities?.length > 0) {
          doc.text('Principais cidades:', margin, y);
          y += 6;
          for (const c of demographics.cities.slice(0, 5)) {
            doc.text(`  • ${c.name}: ${c.count.toLocaleString('pt-BR')}`, margin, y);
            y += 5;
          }
        }
      }

      // === RECOMMENDATIONS ===
      checkPageBreak(50);
      y += 10;
      doc.setFontSize(16);
      doc.setTextColor(200, 245, 66);
      doc.text('Recomendacoes para o Proximo Mes', margin, y);
      y += 10;

      const recommendations = generateRecommendations(allPosts, typeMap, avgEngagement, savesRate, followerGain);

      doc.setFontSize(9);
      doc.setTextColor(60, 60, 60);
      for (let i = 0; i < recommendations.length; i++) {
        checkPageBreak(12);
        doc.text(`${i + 1}. ${recommendations[i]}`, margin, y);
        y += 7;
      }

      // Footer on last page
      y = 280;
      doc.setFontSize(7);
      doc.setTextColor(150, 150, 150);
      doc.text(`Relatorio gerado por Mesaas em ${new Date().toLocaleDateString('pt-BR')}`, pageWidth / 2, y, { align: 'center' });

      // --- Save PDF ---
      const pdfBytes = doc.output('arraybuffer');
      const storagePath = `reports/${cliente.conta_id}/${clientId}/${month}.pdf`;

      // Upload to Supabase Storage
      const { error: uploadError } = await serviceClient.storage
        .from('analytics-reports')
        .upload(storagePath, pdfBytes, {
          contentType: 'application/pdf',
          upsert: true,
        });

      if (uploadError) {
        console.error('Upload error:', uploadError);
        // Try creating the bucket first
        await serviceClient.storage.createBucket('analytics-reports', { public: false });
        const { error: retryError } = await serviceClient.storage
          .from('analytics-reports')
          .upload(storagePath, pdfBytes, {
            contentType: 'application/pdf',
            upsert: true,
          });
        if (retryError) throw new Error('Erro ao salvar PDF: ' + retryError.message);
      }

      // Get signed URL (valid 7 days)
      const { data: signedUrl } = await serviceClient.storage
        .from('analytics-reports')
        .createSignedUrl(storagePath, 7 * 24 * 60 * 60);

      const reportUrl = signedUrl?.signedUrl || '';

      // Update report record
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
    return json({ error: true, message: err.message || 'Erro ao gerar relatorio' }, 500);
  }
});

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

  // Content type recommendations
  const types = Object.entries(typeMap).map(([type, data]) => ({
    type,
    avgEng: data.count > 0 ? data.totalEng / data.count : 0,
    count: data.count,
  })).sort((a, b) => b.avgEng - a.avgEng);

  if (types.length >= 2 && types[0].avgEng > types[1].avgEng * 1.3) {
    recs.push(`${types[0].type}s tiveram o melhor engajamento (${types[0].avgEng.toFixed(1)}%). Considere publicar mais conteudo nesse formato.`);
  }

  // Saves rate
  if (savesRate < 1) {
    recs.push('A taxa de salvamentos esta abaixo de 1%. Invista em conteudo educativo e informativo que os seguidores queiram guardar para consulta futura.');
  } else if (savesRate >= 3) {
    recs.push(`Excelente taxa de salvamentos (${savesRate.toFixed(1)}%)! Continue produzindo conteudo educativo e util.`);
  }

  // Posting frequency
  if (posts.length < 8) {
    recs.push(`Apenas ${posts.length} publicacoes no mes. Busque manter uma frequencia de pelo menos 3 posts por semana para manter o algoritmo engajado.`);
  }

  // Engagement
  if (avgEngagement < 2) {
    recs.push('O engajamento esta abaixo de 2%. Experimente CTAs (chamadas para acao) mais diretas nas legendas e use formatos interativos como enquetes nos Stories.');
  }

  // Follower growth
  if (followerGain <= 0) {
    recs.push('O perfil nao cresceu em seguidores este mes. Considere estrategias de colaboracao com outros perfis da area e conteudo viral (Reels curtos e informativos).');
  }

  // Default if no recs
  if (recs.length === 0) {
    recs.push('Continue mantendo a consistencia de publicacoes e o nivel de engajamento atual.');
    recs.push('Teste novos formatos de conteudo para identificar oportunidades de crescimento.');
    recs.push('Monitore as metricas semanalmente para ajustes rapidos na estrategia.');
  }

  return recs.slice(0, 3);
}
