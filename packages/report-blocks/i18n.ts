// Idioma dos blocos do relatório. O pacote não lê o i18n global (o editor do CRM e o viewer do
// Hub seguem em português até ganharem o idioma do documento): quem renderiza passa `lang` ao
// BlockRenderer, que o põe neste contexto. Ausente = 'pt', saída idêntica à de antes.
// Rótulos dos KPIs em inglês iguais aos do catálogo do report-docs (i18n.test.ts confere).
import { createContext, useContext } from 'react';
import type {
  BenchmarkSource,
  FollowerBand,
  HealthMetricKey,
} from '../../supabase/functions/_shared/report-docs/health-types';
import type { GbpKpiId, GbpSurface, ReportKpiId, TikTokKpiId } from './types';
import { GBP_KPI_LABELS_PT, GBP_KPI_TOOLTIPS_PT, KPI_LABELS_PT } from './types';
import { TIKTOK_KPI_LABELS_PT } from '../../supabase/functions/_shared/report-docs/tiktok-kpi-labels';

export type ReportLang = 'pt' | 'en';

/** Qualquer valor desconhecido (documento antigo, payload sem o campo) vira 'pt'. */
export function normalizeReportLang(value: unknown): ReportLang {
  return value === 'en' ? 'en' : 'pt';
}

export const ReportLangContext = createContext<ReportLang>('pt');

export function useReportLang(): ReportLang {
  return useContext(ReportLangContext);
}

export function intlLocale(lang: ReportLang): string {
  return lang === 'en' ? 'en-US' : 'pt-BR';
}

const MONTHS_PT = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];
const MONTHS_EN = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const COUNTS_TOOLTIP_PT =
  'Total atual dos vídeos publicados no período. Não comparamos com o período anterior porque vídeos mais antigos tiveram mais tempo para acumular números.';
const COUNTS_TOOLTIP_EN =
  'Current total of the videos published in the period. We do not compare with the previous period because older videos have had more time to collect numbers.';

const pt = {
  /** "18 de julho" */
  dayMonth: (day: number, month: number) => `${day} de ${MONTHS_PT[month - 1]}`,
  /** "Julho de 2026" */
  monthYear: (month: number, year: number) => {
    const name = MONTHS_PT[month - 1] ?? '';
    return `${name.charAt(0).toUpperCase()}${name.slice(1)} de ${year}`;
  },
  /** "01–31 de julho" (dias já com dois dígitos) */
  dayRange: (start: string, end: string, month: number) =>
    `${start}–${end} de ${MONTHS_PT[month - 1]}`,
  /** "dd/mm" */
  dayShort: (day: string, month: string) => `${day}/${month}`,
  partial: 'parcial',
  /** Dias como vêm do snapshot (best-times.ts grava os rótulos pt). */
  weekday: (raw: string) => raw,
  ordinal: (n: number) => `${n}º`,
  hour: (h: number) => `${h}h`,
  previous: 'Anterior',
  platformNames: { instagram: 'Instagram', tiktok: 'TikTok', google: 'Google Meu Negócio' },
  and: 'e',
  coverKicker: (names: string) => `Relatório mensal · ${names}`,
  kpi: {
    labels: KPI_LABELS_PT as Record<ReportKpiId, string>,
    tooltips: {
      reach:
        'Soma do alcance diário do mês. O app do Instagram mostra visitantes únicos, um número menor.',
      engagement_rate: 'Contas engajadas ÷ alcance acumulado · análise Mesaas',
    } as Partial<Record<ReportKpiId, string>>,
    tiktokLabels: TIKTOK_KPI_LABELS_PT as Record<TikTokKpiId, string>,
    tiktokTooltips: {
      views:
        'Total atual dos vídeos publicados no período, não as visualizações recebidas no período.',
      engagement_rate:
        'Curtidas, comentários e compartilhamentos divididos pelas visualizações dos vídeos publicados no período. O TikTok não informa alcance, então não é comparável à taxa do Instagram.',
      likes: COUNTS_TOOLTIP_PT,
      comments: COUNTS_TOOLTIP_PT,
      shares: COUNTS_TOOLTIP_PT,
    } as Partial<Record<TikTokKpiId, string>>,
    gbpLabels: GBP_KPI_LABELS_PT as Record<GbpKpiId, string>,
    gbpTooltips: GBP_KPI_TOOLTIPS_PT as Partial<Record<GbpKpiId, string>>,
  },
  followers: { title: 'Evolução de seguidores' },
  formats: {
    labels: { reels: 'Reels', carousels: 'Carrosséis', images: 'Imagens' },
    leader: 'Formato líder',
    withViews: (count: string, avg: string) =>
      `${count} publicações · média de ${avg} visualizações`,
    withReach: (count: string, avg: string) => `${count} publicações · alcance médio ${avg}`,
  },
  audience: {
    gender: 'Gênero',
    genderAria: 'Distribuição por gênero',
    female: 'Feminino',
    male: 'Masculino',
    age: 'Faixa etária',
    cities: 'Cidades',
    countries: 'Países',
  },
  bestTimes: { title: 'Melhores horários para publicar' },
  topPosts: {
    types: { reel: 'Reel', carousel: 'Carrossel', image: 'Imagem' },
    video: 'Vídeo',
    views: 'Vis.',
    reach: 'Alc.',
    comments: 'Com.',
    saves: 'Salv.',
    shares: 'Comp.',
  },
  tags: {
    title: 'Performance por tópico',
    topic: 'Tópico',
    posts: 'Posts',
    avgReach: 'Alcance médio',
    avgEngagement: 'Engajamento médio',
  },
  health: {
    title: 'Saúde do Instagram',
    question: 'Seu Instagram está indo bem?',
    sourceBadge: { mesaas: 'Mesaas', mercado: 'Mercado' } as Record<BenchmarkSource, string>,
    stamp: (dd: string, mm: string) => `Até ${dd}/${mm}`,
    verdict: { great: 'Muito bom', good: 'Bom', avg: 'Na média', bad: 'Ruim', worst: 'Muito ruim' },
    approx: 'cerca de ',
    ahead: (approx: string, pct: number) =>
      `À frente de ${approx}${pct}% das contas do seu tamanho`,
    leadOne: 'Pela métrica disponível',
    leadMany: (n: number) => `Somando as ${n} métricas`,
    summary: (lead: string, approx: string, pct: number) =>
      `${lead}, você está à frente de ${approx}${pct}% das contas do seu tamanho.`,
    metricTitles: {
      engagement_rate: 'Taxa de engajamento',
      posts_30d: 'Posts em 30 dias',
      reel_views: 'Visualizações nos reels',
      reels_share: 'Reels no seu feed',
    } as Record<HealthMetricKey, string>,
    nullReasons: {
      engagement_rate: 'Precisa de pelo menos 3 posts nos últimos 90 dias.',
      posts_30d: null,
      reel_views: 'Precisa de pelo menos 3 reels nos últimos 90 dias.',
      reels_share: 'Precisa de pelo menos 3 posts nos últimos 90 dias.',
    } as Record<HealthMetricKey, string | null>,
    noData: 'Sem dados suficientes.',
    you: 'Você:',
    noReference: 'Ainda sem referência para contas do seu tamanho.',
    peers: (mark: string) => `Contas do seu tamanho${mark}:`,
    engagementHelp: 'Mediana de curtidas + comentários dos seus posts recentes ÷ seguidores.',
    fineMesaasCount: (sample: string, band: string) =>
      `*Comparado com ${sample} contas do seu tamanho no Mesaas (${band}).`,
    fineMesaas: (band: string) => `*Comparado com contas do seu tamanho no Mesaas (${band}).`,
    fineMarket: (band: string) =>
      `†Estimativa de mercado para contas ${band}, a partir de estudos públicos com métricas parecidas.`,
    bestPost: (ratio: string) =>
      `Seu melhor post do período teve ${ratio}x o resultado normal da conta.`,
    viewOnInstagram: 'Ver no Instagram',
    bands: {
      lt1k: 'com menos de 1 mil seguidores',
      '1k_5k': 'de 1 mil a 5 mil seguidores',
      '5k_20k': 'de 5 mil a 20 mil seguidores',
      '20k_100k': 'de 20 mil a 100 mil seguidores',
      '100k_plus': 'com mais de 100 mil seguidores',
    } as Record<FollowerBand, string>,
    sample: (n: number) => `mais de ${n}`,
    highlight: {
      engagement_rate: (v: string, p: string) =>
        `Seu engajamento é ${v} por post; em contas do seu tamanho é ${p}.`,
      posts_30d: (v: string, p: string) =>
        `Você publicou ${v} ${v === '1' ? 'post' : 'posts'} em 30 dias; contas do seu tamanho publicam ${p}.`,
      reel_views: (v: string, p: string) =>
        `Seus reels têm ${v} visualizações; em contas do seu tamanho, ${p}.`,
      reels_share: (v: string, p: string) =>
        `Reels são ${v} do seu feed; em contas do seu tamanho, ${p}.`,
    } as Record<HealthMetricKey, (v: string, p: string) => string>,
  },
  gbp: {
    vsPrevious: (n: number) => `vs. ${n} ${n === 1 ? 'dia anterior' : 'dias anteriores'}`,
    actions: {
      title: 'Ações por dia',
      sub: 'O que as pessoas fizeram depois de ver o perfil',
      aria: 'Gráfico de barras empilhadas: ligações, rotas, cliques no site e mensagens por dia',
      series: {
        calls: 'Ligações',
        directions: 'Rotas',
        websiteClicks: 'Site',
        messages: 'Mensagens',
      },
    },
    keywords: {
      title: 'O que buscaram no Google',
      sub: 'Termos que mostraram o perfil',
      search: 'Busca',
      people: 'Pessoas',
      lessThan: (n: string) => `menos de ${n}`,
      foot: 'O Google só mostra o número exato acima de 15 pessoas por mês.',
    },
    rating: {
      title: 'Avaliações',
      stamp: (date: string) => `Situação em ${date}`,
      stars: (n: number) => `${n} de 5 estrelas`,
      reviews: (count: string, n: number) => `${count} ${n === 1 ? 'avaliação' : 'avaliações'}`,
      inPeriod: (n: string) => `+${n} no período`,
      partial: 'Distribuição das últimas 200 avaliações por unidade.',
    },
    highlight: {
      title: 'Avaliação em destaque',
      stamp: (date: string) => `Avaliação de ${date}`,
    },
    surfaces: {
      title: 'Onde viram o perfil',
      labels: {
        mobile_search: 'Pesquisa Google no celular',
        mobile_maps: 'Google Maps no celular',
        desktop_search: 'Pesquisa Google no computador',
        desktop_maps: 'Google Maps no computador',
      } as Record<GbpSurface, string>,
      sub: (count: string, n: number) =>
        `${count} ${n === 1 ? 'visualização' : 'visualizações'} no período`,
      foot: (mobile: number, maps: number) =>
        `${mobile}% pelo celular. Maps responde por ${maps}% das visualizações.`,
    },
    units: {
      title: 'Comparar unidades',
      unit: 'Unidade',
      views: 'Visualizações',
      calls: 'Ligações',
      directions: 'Rotas',
      website: 'Site',
      rating: 'Nota',
      unnamed: 'Unidade sem nome',
      revoked: 'Autorização expirada',
      noRating: 'sem nota',
    },
  },
};

export type ReportText = typeof pt;

const WEEKDAYS_EN: Record<string, string> = {
  Seg: 'Mon',
  Ter: 'Tue',
  Qua: 'Wed',
  Qui: 'Thu',
  Sex: 'Fri',
  Sab: 'Sat',
  Sáb: 'Sat',
  Dom: 'Sun',
};

const en: ReportText = {
  dayMonth: (day, month) => `${MONTHS_EN[month - 1]} ${day}`,
  monthYear: (month, year) => `${MONTHS_EN[month - 1] ?? ''} ${year}`,
  dayRange: (start, end, month) => `${MONTHS_EN[month - 1]} ${start}–${end}`,
  dayShort: (day, month) => `${month}/${day}`,
  partial: 'partial',
  weekday: (raw) => WEEKDAYS_EN[raw] ?? raw,
  ordinal: (n) => `#${n}`,
  hour: (h) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'am' : 'pm'}`,
  previous: 'Previous',
  platformNames: { instagram: 'Instagram', tiktok: 'TikTok', google: 'Google Business Profile' },
  and: 'and',
  coverKicker: (names) => `Monthly report · ${names}`,
  kpi: {
    labels: {
      followers_gained: 'New followers',
      followers_total: 'Total followers',
      reach: 'Cumulative reach',
      views: 'Views',
      engagement_rate: 'Engagement rate',
      saves: 'Saves',
      posts_count: 'Posts',
      profile_views: 'Profile visits',
      website_clicks: 'Link clicks',
      follows: 'Followers gained',
    },
    tooltips: {
      reach:
        "Sum of the month's daily reach. The Instagram app shows unique visitors, a smaller number.",
      engagement_rate: 'Engaged accounts ÷ cumulative reach · Mesaas analysis',
    },
    tiktokLabels: {
      followers_total: 'Followers',
      followers_gained: 'New followers',
      views: 'Views',
      engagement_rate: 'Engagement per view',
      likes: 'Likes',
      comments: 'Comments',
      shares: 'Shares',
      posts_count: 'Videos published',
      likes_total: 'Total profile likes',
    },
    tiktokTooltips: {
      views:
        'Current total of the videos published in the period, not the views received during the period.',
      engagement_rate:
        'Likes, comments and shares divided by the views of the videos published in the period. TikTok does not report reach, so this is not comparable to the Instagram rate.',
      likes: COUNTS_TOOLTIP_EN,
      comments: COUNTS_TOOLTIP_EN,
      shares: COUNTS_TOOLTIP_EN,
    },
    gbpLabels: {
      profile_views: 'Profile views',
      calls: 'Calls',
      directions: 'Direction requests',
      website_clicks: 'Website clicks',
      messages: 'Messages',
      bookings: 'Bookings',
      avg_rating: 'Average rating',
      new_reviews: 'New reviews',
    },
    gbpTooltips: {
      profile_views:
        'Sum of distinct people who saw the profile each day on each surface. Someone who saw it on Search and Maps on the same day counts twice.',
    },
  },
  followers: { title: 'Follower growth' },
  formats: {
    labels: { reels: 'Reels', carousels: 'Carousels', images: 'Images' },
    leader: 'Top format',
    withViews: (count, avg) => `${count} posts · ${avg} average views`,
    withReach: (count, avg) => `${count} posts · ${avg} average reach`,
  },
  audience: {
    gender: 'Gender',
    genderAria: 'Gender split',
    female: 'Female',
    male: 'Male',
    age: 'Age range',
    cities: 'Cities',
    countries: 'Countries',
  },
  bestTimes: { title: 'Best times to post' },
  topPosts: {
    types: { reel: 'Reel', carousel: 'Carousel', image: 'Image' },
    video: 'Video',
    views: 'Views',
    reach: 'Reach',
    comments: 'Com.',
    saves: 'Saves',
    shares: 'Shares',
  },
  tags: {
    title: 'Performance by topic',
    topic: 'Topic',
    posts: 'Posts',
    avgReach: 'Average reach',
    avgEngagement: 'Average engagement',
  },
  health: {
    title: 'Instagram health',
    question: 'Is your Instagram doing well?',
    sourceBadge: { mesaas: 'Mesaas', mercado: 'Market' },
    stamp: (dd, mm) => `Through ${mm}/${dd}`,
    verdict: { great: 'Very good', good: 'Good', avg: 'Average', bad: 'Poor', worst: 'Very poor' },
    approx: 'about ',
    ahead: (approx, pct) => `Ahead of ${approx}${pct}% of accounts your size`,
    leadOne: 'Based on the available metric',
    leadMany: (n) => `Combining the ${n} metrics`,
    summary: (lead, approx, pct) =>
      `${lead}, you are ahead of ${approx}${pct}% of accounts your size.`,
    metricTitles: {
      engagement_rate: 'Engagement rate',
      posts_30d: 'Posts in 30 days',
      reel_views: 'Reel views',
      reels_share: 'Reels in your feed',
    },
    nullReasons: {
      engagement_rate: 'Needs at least 3 posts in the last 90 days.',
      posts_30d: null,
      reel_views: 'Needs at least 3 reels in the last 90 days.',
      reels_share: 'Needs at least 3 posts in the last 90 days.',
    },
    noData: 'Not enough data.',
    you: 'You:',
    noReference: 'No reference for accounts your size yet.',
    peers: (mark) => `Accounts your size${mark}:`,
    engagementHelp: 'Median of likes + comments on your recent posts ÷ followers.',
    fineMesaasCount: (sample, band) =>
      `*Compared with ${sample} accounts your size on Mesaas (${band}).`,
    fineMesaas: (band) => `*Compared with accounts your size on Mesaas (${band}).`,
    fineMarket: (band) =>
      `†Market estimate for accounts ${band}, based on public studies with similar metrics.`,
    bestPost: (ratio) => `Your best post in the period got ${ratio}x your account's normal result.`,
    viewOnInstagram: 'View on Instagram',
    bands: {
      lt1k: 'with fewer than 1K followers',
      '1k_5k': 'with 1K to 5K followers',
      '5k_20k': 'with 5K to 20K followers',
      '20k_100k': 'with 20K to 100K followers',
      '100k_plus': 'with more than 100K followers',
    },
    sample: (n) => `more than ${n}`,
    highlight: {
      engagement_rate: (v, p) =>
        `Your engagement is ${v} per post; for accounts your size it is ${p}.`,
      posts_30d: (v, p) =>
        `You published ${v} ${v === '1' ? 'post' : 'posts'} in 30 days; accounts your size publish ${p}.`,
      reel_views: (v, p) => `Your reels have ${v} views; for accounts your size, ${p}.`,
      reels_share: (v, p) => `Reels are ${v} of your feed; for accounts your size, ${p}.`,
    },
  },
  gbp: {
    vsPrevious: (n) => `vs. previous ${n} ${n === 1 ? 'day' : 'days'}`,
    actions: {
      title: 'Actions per day',
      sub: 'What people did after seeing the profile',
      aria: 'Stacked bar chart: calls, directions, website clicks and messages per day',
      series: {
        calls: 'Calls',
        directions: 'Directions',
        websiteClicks: 'Website',
        messages: 'Messages',
      },
    },
    keywords: {
      title: 'What people searched on Google',
      sub: 'Terms that showed the profile',
      search: 'Search',
      people: 'People',
      lessThan: (n) => `fewer than ${n}`,
      foot: 'Google only shows the exact number above 15 people per month.',
    },
    rating: {
      title: 'Reviews',
      stamp: (date) => `As of ${date}`,
      stars: (n) => `${n} out of 5 stars`,
      reviews: (count, n) => `${count} ${n === 1 ? 'review' : 'reviews'}`,
      inPeriod: (n) => `+${n} in the period`,
      partial: 'Distribution of the latest 200 reviews per location.',
    },
    highlight: {
      title: 'Featured review',
      stamp: (date) => `Review from ${date}`,
    },
    surfaces: {
      title: 'Where people saw the profile',
      labels: {
        mobile_search: 'Google Search on mobile',
        mobile_maps: 'Google Maps on mobile',
        desktop_search: 'Google Search on desktop',
        desktop_maps: 'Google Maps on desktop',
      },
      sub: (count, n) => `${count} ${n === 1 ? 'view' : 'views'} in the period`,
      foot: (mobile, maps) => `${mobile}% on mobile. Maps accounts for ${maps}% of views.`,
    },
    units: {
      title: 'Compare locations',
      unit: 'Location',
      views: 'Views',
      calls: 'Calls',
      directions: 'Directions',
      website: 'Website',
      rating: 'Rating',
      unnamed: 'Unnamed location',
      revoked: 'Authorization expired',
      noRating: 'no rating',
    },
  },
};

export const REPORT_TEXT: Record<ReportLang, ReportText> = { pt, en };

export function reportText(lang: ReportLang): ReportText {
  return REPORT_TEXT[lang];
}

export function useReportText(): ReportText {
  return REPORT_TEXT[useReportLang()];
}
