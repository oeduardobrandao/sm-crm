-- Saúde do Instagram vs contas do mesmo tamanho: referências de mercado, refresh
-- noturno e cron. Spec: docs/superpowers/specs/2026-11-25-ig-account-health-design.md
-- (seções "Tabela ig_peer_benchmarks", "Cron ig_peer_benchmarks_refresh()", "Seed de
-- mercado", "Privacidade").
--
-- Consome de 20261201000002: ig_peer_benchmarks, ig_follower_band,
-- ig_account_health_metrics. Tudo SQL, então agendar o cron aqui mesmo é seguro.
--
-- Rollback: desligar a chave ig_peer_benchmarks_mesaas (o próximo refresh volta tudo
-- para mercado). Tabelas, função e job podem ficar.

-- -------------------------------------------------------------
-- 1. ig_peer_benchmarks_mercado: referências públicas (só seed, sem grant ao CRM)
-- -------------------------------------------------------------
create table if not exists public.ig_peer_benchmarks_mercado (
  band text not null check (band in ('lt1k', '1k_5k', '5k_20k', '20k_100k', '100k_plus')),
  metric text not null check (metric in ('engagement_rate', 'posts_30d', 'reel_views', 'reels_share')),
  cuts numeric[] not null check (array_length(cuts, 1) = 99),  -- p1..p99, não decrescentes
  computed_at timestamptz not null,
  source_note text not null,  -- fonte, ano e se é estimativa (e de quê)
  primary key (band, metric)
);

comment on table public.ig_peer_benchmarks_mercado is
  'Referências públicas de mercado (p1..p99) por faixa de seguidores e métrica de saúde do Instagram. '
  'Só seed; o refresh copia para ig_peer_benchmarks quando o Mesaas não tem 30 contas. Sem grant ao CRM.';

alter table public.ig_peer_benchmarks_mercado enable row level security;
revoke all on public.ig_peer_benchmarks_mercado from public, anon, authenticated;
grant select, insert, update, delete on public.ig_peer_benchmarks_mercado to service_role;

-- -------------------------------------------------------------
-- 2. Seed de mercado
--
-- Regra (decisão do usuário, spec commit 0706add9d): para cada (faixa, métrica), a fonte
-- pública mais próxima, mesmo quando a definição dela difere um pouco da nossa. A
-- diferença fica registrada no comentário de cada linha e nada é inventado: sem fonte,
-- a linha não entra. O produto rotula esses números como estimativas.
-- Os 99 cortes vêm de uma log-normal ajustada à mediana e aos quartis da fonte
-- (mu = ln m, sigma = (ln q3 - ln q1) / 1.349) ou, sem quartis, de um spread assumido
-- (dito na linha); reels_share em logit-normal limitada a 0..1; posts_30d arredondado.
-- O cálculo fica fora do repo.
-- Na regra estrita (mesma definição) nenhuma fonte passou em 2026-11-25 (0 de 20).
--
-- Para trocar valores: edite as linhas abaixo (cada uma com fonte, ano, diferença de
-- definição e como os cortes foram estimados). Nada fora deste bloco precisa mudar;
-- a cópia para ig_peer_benchmarks roda depois, no passo 5.
-- -------------------------------------------------------------
-- ===== SEED DE MERCADO (início) =====
-- lt1k / engagement_rate fica sem seed de propósito (decisão do usuário, 2026-11-25): a única
-- fonte (Buffer 0-1K) divide por impressões e conta salvamentos, outra escala que a nossa
-- (por seguidores). Sem linha, o cartão mostra "Ainda sem referência" até haver amostra Mesaas.
insert into public.ig_peer_benchmarks_mercado (band, metric, cuts, computed_at, source_note) values
  -- lt1k / posts_30d
  -- fonte: Later, How Often to Post on Instagram (dados jan-out/2023, publicado mar/2025), https://later.com/blog/how-often-post-to-instagram/
  -- diferença de definição: Later: média de posts de feed por semana (2/3/5) nas faixas 0-10K, 10K-100K, 100K-500K, contas que publicam pelo Later, dados de 2023; convertida ×30/7. faixas da fonte cruzam as nossas: interpolação linear em log10(seguidores) entre os pontos médios geométricos das faixas da fonte; faixa nossa fora do intervalo recebe os valores da faixa da ponta
  -- cortes: spread assumido (log-normal sigma 0,6); média→mediana ×exp(−0,18)=0,8353; arredondado para inteiro (fixado na faixa Later 0-10K; spread assumido 0.6; média→mediana ×0.8353)
  ('lt1k', 'posts_30d', '{2,2,2,3,3,3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,5,5,5,5,5,5,5,5,5,5,5,5,6,6,6,6,6,6,6,6,6,6,7,7,7,7,7,7,7,7,7,7,8,8,8,8,8,8,8,8,9,9,9,9,9,9,9,10,10,10,10,10,11,11,11,11,11,12,12,12,12,13,13,13,14,14,14,15,15,16,17,17,18,19,20,22,25,29}'::numeric[], '2026-11-25'::timestamptz, 'Later 2023: média semanal ×30/7, spread assumido'),
  -- lt1k / reel_views
  -- fonte: Metricool x HypeAuditor, Instagram Content Playbook 2025 (jan-jun/2025), via resumo Net Influencer: https://www.netinfluencer.com/instagram-carousels-outperform-reels-for-larger-accounts-content-performance-benchmarks-show/
  -- diferença de definição: Playbook: alcance mediano de Reels (não views) por post na faixa <1K, todos os posts do grupo, não mediana por conta
  -- cortes: mediana 134; spread assumido (log-normal sigma 0,8)
  ('lt1k', 'reel_views', '{20.8377,25.9155,29.7612,33.0259,35.9438,38.6297,41.1493,43.5445,45.8436,48.0671,50.2302,52.3447,54.4197,56.4629,58.4805,60.4776,62.4588,64.428,66.3884,68.3433,70.2951,72.2466,74.1999,76.1571,78.1201,80.091,82.0714,84.063,86.0675,88.0865,90.1216,92.1742,94.2461,96.3386,98.4534,100.592,102.756,104.947,107.167,109.417,111.699,114.014,116.366,118.755,121.184,123.655,126.169,128.73,131.339,134.0,136.715,139.486,142.317,145.211,148.171,151.202,154.306,157.489,160.754,164.107,167.552,171.096,174.744,178.503,182.381,186.384,190.523,194.805,199.242,203.845,208.627,213.602,218.785,224.195,229.851,235.776,241.995,248.538,255.437,262.733,270.469,278.699,287.485,296.903,307.043,318.014,329.954,343.034,357.474,373.561,391.679,412.36,436.362,464.824,499.557,543.695,603.336,692.868,861.709}'::numeric[], '2026-11-25'::timestamptz, 'Playbook 2025 <1K: alcance mediano de Reels, não views; spread assumido'),
  -- lt1k / reels_share
  -- fonte: Metricool x HypeAuditor, Instagram Content Playbook 2025 (jan-jun/2025), via resumo Net Influencer: https://www.netinfluencer.com/instagram-carousels-outperform-reels-for-larger-accounts-content-performance-benchmarks-show/
  -- diferença de definição: Playbook: participação de Reels no total de posts da faixa (agregada, não por conta, não só os 12 últimos), média simples de marcas e criadores. Faixas públicas <1K, 10K-50K, 500K-1M. faixas da fonte cruzam as nossas: interpolação linear em log10(seguidores) entre os pontos médios geométricos das faixas da fonte; faixa nossa fora do intervalo recebe os valores da faixa da ponta (ponto da faixa <1K = 316 seguidores)
  -- cortes: spread assumido (logit-normal sigma 0,8), centro = participação da fonte (fixado na faixa PB <1K; spread assumido (logit 0.8))
  ('lt1k', 'reels_share', '{0.0951787,0.115689,0.130614,0.142895,0.153581,0.163185,0.171998,0.180205,0.187932,0.195267,0.202277,0.209012,0.215512,0.221809,0.227928,0.233891,0.239716,0.245419,0.251012,0.256508,0.261915,0.267243,0.272499,0.277691,0.282824,0.287905,0.292939,0.29793,0.302882,0.3078,0.312688,0.317548,0.322385,0.327201,0.331999,0.336782,0.341552,0.346313,0.351066,0.355814,0.360559,0.365304,0.37005,0.3748,0.379556,0.38432,0.389095,0.393881,0.398682,0.4035,0.408336,0.413193,0.418074,0.422979,0.427912,0.432876,0.437872,0.442903,0.447972,0.453082,0.458236,0.463436,0.468686,0.47399,0.47935,0.484772,0.490258,0.495814,0.501444,0.507154,0.512948,0.518834,0.524817,0.530904,0.537104,0.543425,0.549877,0.556471,0.563218,0.570133,0.57723,0.584528,0.592046,0.599808,0.607841,0.616177,0.624856,0.633924,0.643439,0.653473,0.664118,0.675497,0.687773,0.701179,0.716056,0.732951,0.752824,0.777663,0.813084}'::numeric[], '2026-11-25'::timestamptz, 'Playbook 2025: participação de Reels agregada por faixa; spread assumido'),
  -- 1k_5k / engagement_rate
  -- fonte: IQFluence, Influencer engagement rate benchmarks 2026 (contagem set/2026), https://iqfluence.io/public/industry-reports/influencer-engagement-rate-benchmarks-2026-what-good-looks-like-across-different-creators
  -- diferença de definição: IQFluence: média de (curtidas+comentários) dos posts recentes (quantidade não informada) ÷ seguidores, por conta; nós: mediana dos 12 últimos. Faixas 1K-10K, 10K-100K, 100K-500K. faixas da fonte cruzam as nossas: interpolação linear em log10(seguidores) entre os pontos médios geométricos das faixas da fonte; faixa nossa fora do intervalo recebe os valores da faixa da ponta
  -- cortes: log-normal pelos quartis p25/mediana/p75 da fonte (fixado na faixa IQF 1K-10K)
  ('1k_5k', 'engagement_rate', '{0.00112765,0.00164231,0.00208474,0.00249449,0.00288651,0.00326836,0.0036445,0.00401789,0.00439058,0.00476413,0.00513974,0.0055184,0.00590094,0.00628807,0.00668042,0.00707858,0.00748308,0.00789443,0.00831312,0.00873961,0.00917436,0.00961785,0.0100705,0.0105328,0.0110053,0.0114883,0.0119824,0.0124881,0.0130059,0.0135363,0.0140799,0.0146374,0.0152092,0.015796,0.0163986,0.0170175,0.0176535,0.0183075,0.0189801,0.0196723,0.020385,0.0211191,0.0218756,0.0226557,0.0234604,0.0242911,0.0251489,0.0260353,0.0269518,0.0279,0.0288815,0.0298982,0.030952,0.0320451,0.0331797,0.0343583,0.0355835,0.0368582,0.0381855,0.0395689,0.0410119,0.0425187,0.0440937,0.0457418,0.0474682,0.0492788,0.0511802,0.0531796,0.055285,0.0575054,0.0598507,0.0623323,0.0649629,0.0677569,0.0707308,0.0739033,0.077296,0.0809339,0.0848462,0.0890669,0.0936363,0.0986024,0.104023,0.109967,0.116521,0.123792,0.131913,0.141057,0.151449,0.16339,0.177291,0.193736,0.213585,0.238165,0.269671,0.312051,0.373385,0.473973,0.690295}'::numeric[], '2026-11-25'::timestamptz, 'IQFluence 2026: média dos posts recentes, não mediana de 12; faixas interpoladas'),
  -- 1k_5k / posts_30d
  -- fonte: Later, How Often to Post on Instagram (dados jan-out/2023, publicado mar/2025), https://later.com/blog/how-often-post-to-instagram/
  -- diferença de definição: Later: média de posts de feed por semana (2/3/5) nas faixas 0-10K, 10K-100K, 100K-500K, contas que publicam pelo Later, dados de 2023; convertida ×30/7. faixas da fonte cruzam as nossas: interpolação linear em log10(seguidores) entre os pontos médios geométricos das faixas da fonte; faixa nossa fora do intervalo recebe os valores da faixa da ponta
  -- cortes: spread assumido (log-normal sigma 0,6); média→mediana ×exp(−0,18)=0,8353; arredondado para inteiro (fixado na faixa Later 0-10K; spread assumido 0.6; média→mediana ×0.8353)
  ('1k_5k', 'posts_30d', '{2,2,2,3,3,3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,5,5,5,5,5,5,5,5,5,5,5,5,6,6,6,6,6,6,6,6,6,6,7,7,7,7,7,7,7,7,7,7,8,8,8,8,8,8,8,8,9,9,9,9,9,9,9,10,10,10,10,10,11,11,11,11,11,12,12,12,12,13,13,13,14,14,14,15,15,16,17,17,18,19,20,22,25,29}'::numeric[], '2026-11-25'::timestamptz, 'Later 2023: média semanal ×30/7, spread assumido'),
  -- 1k_5k / reel_views
  -- fonte: Socialinsider, 2026 Instagram Organic Benchmarks (dados de 2025), https://www.socialinsider.io/blog/instagram-benchmark-study/
  -- diferença de definição: Socialinsider: média de views por Reel de todos os Reels da faixa (marcas), não mediana dos 12 últimos por conta. Faixas 1K-5K, 5K-10K, 10K-50K, 50K-100K, 100K-1M (sem 1M+). faixas da fonte cruzam as nossas: interpolação linear em log10(seguidores) entre os pontos médios geométricos das faixas da fonte; faixa nossa fora do intervalo recebe os valores da faixa da ponta
  -- cortes: spread assumido (log-normal sigma 0,8); média→mediana ×exp(−0,32)=0,7261 (fixado na faixa SI 1K-5K; spread assumido 0.8; média→mediana ×0.7261)
  ('1k_5k', 'reel_views', '{65.4934,81.4532,93.5404,103.801,112.973,121.414,129.334,136.862,144.088,151.077,157.875,164.521,171.043,177.465,183.806,190.083,196.31,202.499,208.661,214.805,220.94,227.073,233.213,239.364,245.534,251.729,257.953,264.213,270.513,276.859,283.255,289.707,296.219,302.795,309.442,316.164,322.965,329.852,336.828,343.9,351.072,358.351,365.742,373.252,380.886,388.651,396.554,404.603,412.804,421.166,429.698,438.408,447.306,456.402,465.707,475.232,484.99,494.993,505.255,515.793,526.622,537.76,549.226,561.042,573.229,585.812,598.819,612.278,626.224,640.692,655.721,671.357,687.649,704.652,722.43,741.052,760.598,781.162,802.848,825.777,850.092,875.96,903.576,933.177,965.045,999.528,1037.06,1078.17,1123.55,1174.11,1231.06,1296.06,1371.5,1460.96,1570.13,1708.85,1896.31,2177.71,2708.38}'::numeric[], '2026-11-25'::timestamptz, 'Socialinsider 2025: média de views por Reel; spread assumido'),
  -- 1k_5k / reels_share
  -- fonte: Metricool x HypeAuditor, Instagram Content Playbook 2025 (jan-jun/2025), via resumo Net Influencer: https://www.netinfluencer.com/instagram-carousels-outperform-reels-for-larger-accounts-content-performance-benchmarks-show/
  -- diferença de definição: Playbook: participação de Reels no total de posts da faixa (agregada, não por conta, não só os 12 últimos), média simples de marcas e criadores. Faixas públicas <1K, 10K-50K, 500K-1M. faixas da fonte cruzam as nossas: interpolação linear em log10(seguidores) entre os pontos médios geométricos das faixas da fonte; faixa nossa fora do intervalo recebe os valores da faixa da ponta (ponto da faixa <1K = 316 seguidores)
  -- cortes: spread assumido (logit-normal sigma 0,8), centro = participação da fonte (interpolado entre PB <1K e PB 10K-50K, t=0.459; spread assumido (logit 0.8))
  ('1k_5k', 'reels_share', '{0.120306,0.145361,0.163407,0.178139,0.190874,0.202252,0.212639,0.222265,0.231286,0.239814,0.247931,0.255699,0.263167,0.270377,0.277358,0.284139,0.290741,0.297183,0.303481,0.30965,0.315702,0.321647,0.327495,0.333255,0.338934,0.344538,0.350075,0.35555,0.360968,0.366334,0.371652,0.376926,0.38216,0.387359,0.392524,0.39766,0.402769,0.407854,0.412919,0.417964,0.422994,0.428011,0.433016,0.438012,0.443002,0.447988,0.452971,0.457954,0.46294,0.46793,0.472926,0.477931,0.482946,0.487975,0.493018,0.498079,0.50316,0.508264,0.513391,0.518546,0.523732,0.528949,0.534203,0.539495,0.544829,0.550208,0.555637,0.561118,0.566657,0.572256,0.577922,0.58366,0.589474,0.595372,0.60136,0.607445,0.613635,0.619941,0.626371,0.632937,0.639653,0.646533,0.653594,0.660855,0.668341,0.676076,0.684095,0.692436,0.701147,0.710288,0.719936,0.730193,0.741192,0.753127,0.76628,0.781101,0.798376,0.819733,0.849747}'::numeric[], '2026-11-25'::timestamptz, 'Playbook 2025: participação de Reels agregada por faixa; spread assumido'),
  -- 5k_20k / engagement_rate
  -- fonte: IQFluence, Influencer engagement rate benchmarks 2026 (contagem set/2026), https://iqfluence.io/public/industry-reports/influencer-engagement-rate-benchmarks-2026-what-good-looks-like-across-different-creators
  -- diferença de definição: IQFluence: média de (curtidas+comentários) dos posts recentes (quantidade não informada) ÷ seguidores, por conta; nós: mediana dos 12 últimos. Faixas 1K-10K, 10K-100K, 100K-500K. faixas da fonte cruzam as nossas: interpolação linear em log10(seguidores) entre os pontos médios geométricos das faixas da fonte; faixa nossa fora do intervalo recebe os valores da faixa da ponta
  -- cortes: log-normal pelos quartis p25/mediana/p75 da fonte (interpolado entre IQF 1K-10K e IQF 10K-100K, t=0.500)
  ('5k_20k', 'engagement_rate', '{0.000404781,0.000624824,0.000822959,0.00101243,0.00119829,0.00138313,0.00156852,0.0017555,0.00194484,0.00213713,0.00233285,0.00253241,0.00273618,0.00294448,0.00315763,0.00337593,0.00359965,0.00382909,0.00406453,0.00430625,0.00455454,0.0048097,0.00507202,0.00534182,0.00561943,0.00590517,0.0061994,0.00650247,0.00681478,0.00713671,0.00746868,0.00781114,0.00816454,0.00852937,0.00890614,0.0092954,0.00969771,0.0101137,0.0105439,0.0109892,0.0114502,0.0119276,0.0124223,0.0129352,0.0134672,0.0140193,0.0145925,0.015188,0.015807,0.0164508,0.0171209,0.0178187,0.0185459,0.0193042,0.0200955,0.020922,0.0217858,0.0226894,0.0236355,0.0246269,0.0256669,0.0267588,0.0279066,0.0291144,0.0303869,0.0317292,0.033147,0.0346467,0.0362353,0.0379209,0.0397123,0.0416196,0.0436543,0.0458294,0.0481597,0.0506625,0.0533575,0.0562676,0.0594199,0.0628459,0.0665834,0.0706774,0.0751823,0.0801647,0.0857067,0.091911,0.0989081,0.106867,0.116008,0.126632,0.139153,0.154161,0.172539,0.195665,0.225847,0.267308,0.32885,0.43313,0.668583}'::numeric[], '2026-11-25'::timestamptz, 'IQFluence 2026: média dos posts recentes, não mediana de 12; faixas interpoladas'),
  -- 5k_20k / posts_30d
  -- fonte: Later, How Often to Post on Instagram (dados jan-out/2023, publicado mar/2025), https://later.com/blog/how-often-post-to-instagram/
  -- diferença de definição: Later: média de posts de feed por semana (2/3/5) nas faixas 0-10K, 10K-100K, 100K-500K, contas que publicam pelo Later, dados de 2023; convertida ×30/7. faixas da fonte cruzam as nossas: interpolação linear em log10(seguidores) entre os pontos médios geométricos das faixas da fonte; faixa nossa fora do intervalo recebe os valores da faixa da ponta
  -- cortes: spread assumido (log-normal sigma 0,6); média→mediana ×exp(−0,18)=0,8353; arredondado para inteiro (interpolado entre Later 0-10K e Later 10K-100K, t=0.500; spread assumido 0.6; média→mediana ×0.8353)
  ('5k_20k', 'posts_30d', '{2,3,3,3,3,3,4,4,4,4,4,4,4,5,5,5,5,5,5,5,5,6,6,6,6,6,6,6,6,6,7,7,7,7,7,7,7,7,7,8,8,8,8,8,8,8,8,9,9,9,9,9,9,9,9,10,10,10,10,10,10,11,11,11,11,11,11,12,12,12,12,12,13,13,13,13,14,14,14,15,15,15,16,16,16,17,17,18,18,19,20,20,21,22,24,25,27,30,35}'::numeric[], '2026-11-25'::timestamptz, 'Later 2023: média semanal ×30/7, spread assumido'),
  -- 5k_20k / reel_views
  -- fonte: Socialinsider, 2026 Instagram Organic Benchmarks (dados de 2025), https://www.socialinsider.io/blog/instagram-benchmark-study/
  -- diferença de definição: Socialinsider: média de views por Reel de todos os Reels da faixa (marcas), não mediana dos 12 últimos por conta. Faixas 1K-5K, 5K-10K, 10K-50K, 50K-100K, 100K-1M (sem 1M+). faixas da fonte cruzam as nossas: interpolação linear em log10(seguidores) entre os pontos médios geométricos das faixas da fonte; faixa nossa fora do intervalo recebe os valores da faixa da ponta
  -- cortes: spread assumido (log-normal sigma 0,8); média→mediana ×exp(−0,32)=0,7261 (interpolado entre SI 5K-10K e SI 10K-50K, t=0.301; spread assumido 0.8; média→mediana ×0.7261)
  ('5k_20k', 'reel_views', '{148.065,184.146,211.473,234.67,255.404,274.489,292.393,309.412,325.749,341.548,356.919,371.943,386.688,401.206,415.542,429.733,443.811,457.803,471.733,485.623,499.493,513.359,527.238,541.146,555.095,569.099,583.171,597.323,611.566,625.912,640.373,654.958,669.68,684.549,699.576,714.772,730.148,745.717,761.489,777.476,793.691,810.147,826.856,843.833,861.092,878.647,896.515,914.71,933.252,952.158,971.446,991.138,1011.25,1031.82,1052.85,1074.39,1096.45,1119.06,1142.26,1166.09,1190.57,1215.75,1241.67,1268.38,1295.93,1324.38,1353.79,1384.22,1415.74,1448.45,1482.43,1517.78,1554.61,1593.05,1633.24,1675.34,1719.53,1766.02,1815.05,1866.89,1921.86,1980.34,2042.77,2109.69,2181.74,2259.7,2344.54,2437.48,2540.09,2654.39,2783.14,2930.09,3100.64,3302.88,3549.68,3863.31,4287.1,4923.28,6123.01}'::numeric[], '2026-11-25'::timestamptz, 'Socialinsider 2025: média de views por Reel; spread assumido'),
  -- 5k_20k / reels_share
  -- fonte: Metricool x HypeAuditor, Instagram Content Playbook 2025 (jan-jun/2025), via resumo Net Influencer: https://www.netinfluencer.com/instagram-carousels-outperform-reels-for-larger-accounts-content-performance-benchmarks-show/
  -- diferença de definição: Playbook: participação de Reels no total de posts da faixa (agregada, não por conta, não só os 12 últimos), média simples de marcas e criadores. Faixas públicas <1K, 10K-50K, 500K-1M. faixas da fonte cruzam as nossas: interpolação linear em log10(seguidores) entre os pontos médios geométricos das faixas da fonte; faixa nossa fora do intervalo recebe os valores da faixa da ponta (ponto da faixa <1K = 316 seguidores)
  -- cortes: spread assumido (logit-normal sigma 0,8), centro = participação da fonte (interpolado entre PB <1K e PB 10K-50K, t=0.811; spread assumido (logit 0.8))
  ('5k_20k', 'reels_share', '{0.143249,0.172148,0.192769,0.209485,0.223851,0.23662,0.248222,0.258929,0.268924,0.278337,0.287265,0.29578,0.303942,0.311795,0.319378,0.326722,0.333852,0.34079,0.347556,0.354165,0.360632,0.36697,0.373189,0.379299,0.385309,0.391226,0.397059,0.402813,0.408495,0.414109,0.419661,0.425156,0.430597,0.43599,0.441336,0.446641,0.451908,0.457138,0.462337,0.467506,0.472647,0.477765,0.482861,0.487938,0.492997,0.498042,0.503075,0.508098,0.513112,0.518121,0.523126,0.52813,0.533134,0.538142,0.543154,0.548173,0.553202,0.558242,0.563297,0.568368,0.573457,0.578569,0.583704,0.588867,0.594059,0.599285,0.604547,0.609848,0.615194,0.620586,0.62603,0.631531,0.637092,0.642721,0.648422,0.654201,0.660067,0.666027,0.67209,0.678266,0.684565,0.691002,0.69759,0.704347,0.711291,0.718447,0.725842,0.73351,0.741492,0.74984,0.758618,0.767915,0.777845,0.788571,0.800337,0.813523,0.828801,0.84755,0.873647}'::numeric[], '2026-11-25'::timestamptz, 'Playbook 2025: participação de Reels agregada por faixa; spread assumido'),
  -- 20k_100k / engagement_rate
  -- fonte: IQFluence, Influencer engagement rate benchmarks 2026 (contagem set/2026), https://iqfluence.io/public/industry-reports/influencer-engagement-rate-benchmarks-2026-what-good-looks-like-across-different-creators
  -- diferença de definição: IQFluence: média de (curtidas+comentários) dos posts recentes (quantidade não informada) ÷ seguidores, por conta; nós: mediana dos 12 últimos. Faixas 1K-10K, 10K-100K, 100K-500K. faixas da fonte cruzam as nossas: interpolação linear em log10(seguidores) entre os pontos médios geométricos das faixas da fonte; faixa nossa fora do intervalo recebe os valores da faixa da ponta
  -- cortes: log-normal pelos quartis p25/mediana/p75 da fonte (interpolado entre IQF 10K-100K e IQF 100K-500K, t=0.177)
  ('20k_100k', 'engagement_rate', '{0.000142891,0.000233705,0.000319323,0.00040384,0.000488833,0.00057513,0.000663243,0.000753533,0.000846279,0.000941711,0.00104003,0.00114141,0.00124604,0.00135408,0.00146569,0.00158104,0.00170029,0.00182362,0.00195121,0.00208322,0.00221986,0.00236131,0.00250778,0.00265949,0.00281665,0.00297951,0.0031483,0.00332328,0.00350474,0.00369295,0.00388822,0.00409088,0.00430125,0.00451971,0.00474662,0.0049824,0.00522748,0.0054823,0.00574736,0.00602318,0.00631029,0.00660929,0.00692081,0.00724552,0.00758413,0.00793742,0.00830621,0.00869138,0.0090939,0.00951479,0.00995516,0.0104162,0.0108992,0.0114056,0.0119369,0.0124948,0.013081,0.0136976,0.0143466,0.0150305,0.0157518,0.0165134,0.0173183,0.0181702,0.0190728,0.0200303,0.0210477,0.02213,0.0232835,0.0245146,0.0258311,0.0272415,0.0287556,0.0303847,0.0321414,0.0340408,0.0361001,0.0383394,0.0407825,0.0434573,0.0463976,0.0496437,0.0532446,0.0572607,0.0617671,0.0668583,0.0726551,0.079315,0.087047,0.0961349,0.106976,0.120142,0.136498,0.15741,0.185199,0.224176,0.28351,0.387374,0.633569}'::numeric[], '2026-11-25'::timestamptz, 'IQFluence 2026: média dos posts recentes, não mediana de 12; faixas interpoladas'),
  -- 20k_100k / posts_30d
  -- fonte: Later, How Often to Post on Instagram (dados jan-out/2023, publicado mar/2025), https://later.com/blog/how-often-post-to-instagram/
  -- diferença de definição: Later: média de posts de feed por semana (2/3/5) nas faixas 0-10K, 10K-100K, 100K-500K, contas que publicam pelo Later, dados de 2023; convertida ×30/7. faixas da fonte cruzam as nossas: interpolação linear em log10(seguidores) entre os pontos médios geométricos das faixas da fonte; faixa nossa fora do intervalo recebe os valores da faixa da ponta
  -- cortes: spread assumido (log-normal sigma 0,6); média→mediana ×exp(−0,18)=0,8353; arredondado para inteiro (interpolado entre Later 10K-100K e Later 100K-500K, t=0.177; spread assumido 0.6; média→mediana ×0.8353)
  ('20k_100k', 'posts_30d', '{3,3,4,4,4,5,5,5,5,5,6,6,6,6,6,6,7,7,7,7,7,7,8,8,8,8,8,8,8,9,9,9,9,9,9,9,10,10,10,10,10,10,11,11,11,11,11,11,12,12,12,12,12,12,13,13,13,13,13,14,14,14,14,15,15,15,15,16,16,16,16,17,17,17,18,18,18,19,19,19,20,20,21,21,22,22,23,24,25,25,26,27,28,30,32,34,36,40,47}'::numeric[], '2026-11-25'::timestamptz, 'Later 2023: média semanal ×30/7, spread assumido'),
  -- 20k_100k / reel_views
  -- fonte: Socialinsider, 2026 Instagram Organic Benchmarks (dados de 2025), https://www.socialinsider.io/blog/instagram-benchmark-study/
  -- diferença de definição: Socialinsider: média de views por Reel de todos os Reels da faixa (marcas), não mediana dos 12 últimos por conta. Faixas 1K-5K, 5K-10K, 10K-50K, 50K-100K, 100K-1M (sem 1M+). faixas da fonte cruzam as nossas: interpolação linear em log10(seguidores) entre os pontos médios geométricos das faixas da fonte; faixa nossa fora do intervalo recebe os valores da faixa da ponta
  -- cortes: spread assumido (log-normal sigma 0,8); média→mediana ×exp(−0,32)=0,7261 (interpolado entre SI 10K-50K e SI 50K-100K, t=0.602; spread assumido 0.8; média→mediana ×0.7261)
  ('20k_100k', 'reel_views', '{479.667,596.555,685.08,760.23,827.399,889.226,947.226,1002.36,1055.29,1106.47,1156.26,1204.94,1252.7,1299.73,1346.18,1392.15,1437.76,1483.08,1528.21,1573.21,1618.14,1663.06,1708.02,1753.08,1798.27,1843.63,1889.22,1935.07,1981.21,2027.68,2074.53,2121.78,2169.47,2217.64,2266.32,2315.55,2365.37,2415.8,2466.89,2518.69,2571.22,2624.53,2678.66,2733.66,2789.57,2846.44,2904.32,2963.27,3023.33,3084.58,3147.06,3210.86,3276.03,3342.64,3410.79,3480.55,3552.01,3625.27,3700.44,3777.61,3856.93,3938.5,4022.48,4109.01,4198.27,4290.42,4385.68,4484.26,4586.4,4692.36,4802.43,4916.95,5036.27,5160.8,5291.0,5427.38,5570.54,5721.15,5879.97,6047.91,6225.99,6415.44,6617.7,6834.49,7067.89,7320.44,7595.29,7896.38,8228.78,8599.09,9016.17,9492.22,10044.7,10699.9,11499.4,12515.5,13888.3,15949.3,19835.9}'::numeric[], '2026-11-25'::timestamptz, 'Socialinsider 2025: média de views por Reel; spread assumido'),
  -- 20k_100k / reels_share
  -- fonte: Metricool x HypeAuditor, Instagram Content Playbook 2025 (jan-jun/2025), via resumo Net Influencer: https://www.netinfluencer.com/instagram-carousels-outperform-reels-for-larger-accounts-content-performance-benchmarks-show/
  -- diferença de definição: Playbook: participação de Reels no total de posts da faixa (agregada, não por conta, não só os 12 últimos), média simples de marcas e criadores. Faixas públicas <1K, 10K-50K, 500K-1M. faixas da fonte cruzam as nossas: interpolação linear em log10(seguidores) entre os pontos médios geométricos das faixas da fonte; faixa nossa fora do intervalo recebe os valores da faixa da ponta (ponto da faixa <1K = 316 seguidores)
  -- cortes: spread assumido (logit-normal sigma 0,8), centro = participação da fonte (interpolado entre PB 10K-50K e PB 500K-1M, t=0.201; spread assumido (logit 0.8))
  ('20k_100k', 'reels_share', '{0.171549,0.204792,0.228245,0.247096,0.263182,0.277393,0.290235,0.302026,0.312982,0.323255,0.332959,0.342179,0.350983,0.359424,0.367547,0.375387,0.382974,0.390336,0.397492,0.404462,0.411263,0.417909,0.424412,0.430784,0.437036,0.443175,0.449211,0.45515,0.461,0.466766,0.472455,0.478072,0.483621,0.489107,0.494534,0.499906,0.505227,0.5105,0.515729,0.520916,0.526065,0.531178,0.536259,0.541309,0.546332,0.551329,0.556304,0.561258,0.566193,0.571112,0.576017,0.580911,0.585794,0.59067,0.595541,0.600408,0.605274,0.610141,0.615011,0.619887,0.62477,0.629664,0.63457,0.639491,0.644431,0.64939,0.654374,0.659384,0.664424,0.669497,0.674607,0.679759,0.684956,0.690203,0.695505,0.700867,0.706297,0.7118,0.717385,0.723059,0.728832,0.734716,0.740722,0.746864,0.75316,0.759629,0.766294,0.773184,0.780334,0.787786,0.795596,0.803836,0.812604,0.822037,0.832336,0.843821,0.857053,0.873182,0.895432}'::numeric[], '2026-11-25'::timestamptz, 'Playbook 2025: participação de Reels agregada por faixa; spread assumido'),
  -- 100k_plus / engagement_rate
  -- fonte: IQFluence, Influencer engagement rate benchmarks 2026 (contagem set/2026), https://iqfluence.io/public/industry-reports/influencer-engagement-rate-benchmarks-2026-what-good-looks-like-across-different-creators
  -- diferença de definição: IQFluence: média de (curtidas+comentários) dos posts recentes (quantidade não informada) ÷ seguidores, por conta; nós: mediana dos 12 últimos. Faixas 1K-10K, 10K-100K, 100K-500K. faixas da fonte cruzam as nossas: interpolação linear em log10(seguidores) entre os pontos médios geométricos das faixas da fonte; faixa nossa fora do intervalo recebe os valores da faixa da ponta
  -- cortes: log-normal pelos quartis p25/mediana/p75 da fonte (fixado na faixa IQF 100K-500K)
  ('100k_plus', 'engagement_rate', '{0.000132215,0.000215944,0.000294795,0.000372572,0.000450741,0.000530069,0.000611032,0.000693964,0.000779122,0.000866719,0.000956938,0.00104995,0.00114591,0.00124497,0.00134728,0.001453,0.00156228,0.00167527,0.00179213,0.00191303,0.00203813,0.00216763,0.0023017,0.00244053,0.00258433,0.00273332,0.00288771,0.00304775,0.00321368,0.00338576,0.00356427,0.0037495,0.00394176,0.00414137,0.00434869,0.00456408,0.00478793,0.00502065,0.00526269,0.00551451,0.00577662,0.00604954,0.00633385,0.00663016,0.00693912,0.00726142,0.00759783,0.00794914,0.00831622,0.0087,0.00910149,0.00952179,0.00996206,0.0104236,0.0109077,0.011416,0.0119501,0.0125117,0.0131028,0.0137256,0.0143824,0.0150757,0.0158085,0.0165838,0.0174052,0.0182765,0.0192021,0.0201867,0.0212358,0.0223554,0.0235525,0.0248347,0.0262111,0.0276916,0.029288,0.0310138,0.0328845,0.0349183,0.0371369,0.0395656,0.0422347,0.0451809,0.0484485,0.0520921,0.0561797,0.0607967,0.0660525,0.0720893,0.079096,0.0873294,0.0971478,0.109069,0.123872,0.142793,0.167924,0.203155,0.256755,0.350508,0.572476}'::numeric[], '2026-11-25'::timestamptz, 'IQFluence 2026: média dos posts recentes, não mediana de 12; faixas interpoladas'),
  -- 100k_plus / posts_30d
  -- fonte: Later, How Often to Post on Instagram (dados jan-out/2023, publicado mar/2025), https://later.com/blog/how-often-post-to-instagram/
  -- diferença de definição: Later: média de posts de feed por semana (2/3/5) nas faixas 0-10K, 10K-100K, 100K-500K, contas que publicam pelo Later, dados de 2023; convertida ×30/7. faixas da fonte cruzam as nossas: interpolação linear em log10(seguidores) entre os pontos médios geométricos das faixas da fonte; faixa nossa fora do intervalo recebe os valores da faixa da ponta
  -- cortes: spread assumido (log-normal sigma 0,6); média→mediana ×exp(−0,18)=0,8353; arredondado para inteiro (fixado na faixa Later 100K-500K; spread assumido 0.6; média→mediana ×0.8353)
  ('100k_plus', 'posts_30d', '{4,5,6,6,7,7,7,8,8,8,9,9,9,9,10,10,10,10,11,11,11,11,11,12,12,12,12,13,13,13,13,14,14,14,14,14,15,15,15,15,16,16,16,16,17,17,17,17,18,18,18,18,19,19,19,20,20,20,21,21,21,21,22,22,23,23,23,24,24,25,25,25,26,26,27,27,28,28,29,30,30,31,32,33,33,34,35,36,37,39,40,42,43,45,48,51,55,61,72}'::numeric[], '2026-11-25'::timestamptz, 'Later 2023: média semanal ×30/7, spread assumido'),
  -- 100k_plus / reel_views
  -- fonte: Socialinsider, 2026 Instagram Organic Benchmarks (dados de 2025), https://www.socialinsider.io/blog/instagram-benchmark-study/
  -- diferença de definição: Socialinsider: média de views por Reel de todos os Reels da faixa (marcas), não mediana dos 12 últimos por conta. Faixas 1K-5K, 5K-10K, 10K-50K, 50K-100K, 100K-1M (sem 1M+). faixas da fonte cruzam as nossas: interpolação linear em log10(seguidores) entre os pontos médios geométricos das faixas da fonte; faixa nossa fora do intervalo recebe os valores da faixa da ponta
  -- cortes: spread assumido (log-normal sigma 0,8); média→mediana ×exp(−0,32)=0,7261 (interpolado entre SI 50K-100K e SI 100K-1M, t=0.769; spread assumido 0.8; média→mediana ×0.7261)
  ('100k_plus', 'reel_views', '{1447.56,1800.31,2067.47,2294.26,2496.97,2683.55,2858.59,3024.98,3184.7,3339.16,3489.43,3636.32,3780.47,3922.41,4062.56,4201.3,4338.93,4475.73,4611.92,4747.72,4883.31,5018.88,5154.57,5290.53,5426.9,5563.82,5701.39,5839.75,5979.0,6119.25,6260.63,6403.22,6547.15,6692.52,6839.43,6987.99,7138.32,7290.53,7444.72,7601.02,7759.55,7920.43,8083.79,8249.77,8418.5,8590.13,8764.81,8942.7,9123.97,9308.8,9497.38,9689.89,9886.56,10087.6,10293.3,10503.8,10719.5,10940.5,11167.4,11400.3,11639.6,11885.8,12139.2,12400.4,12669.7,12947.9,13235.3,13532.8,13841.1,14160.8,14493.0,14838.6,15198.7,15574.5,15967.5,16379.0,16811.1,17265.6,17744.9,18251.7,18789.1,19360.8,19971.2,20625.5,21329.8,22092.0,22921.5,23830.1,24833.2,25950.8,27209.5,28646.1,30313.5,32290.7,34703.6,37769.8,41913.0,48132.6,59861.8}'::numeric[], '2026-11-25'::timestamptz, 'Socialinsider 2025: média de views por Reel; spread assumido'),
  -- 100k_plus / reels_share
  -- fonte: Metricool x HypeAuditor, Instagram Content Playbook 2025 (jan-jun/2025), via resumo Net Influencer: https://www.netinfluencer.com/instagram-carousels-outperform-reels-for-larger-accounts-content-performance-benchmarks-show/
  -- diferença de definição: Playbook: participação de Reels no total de posts da faixa (agregada, não por conta, não só os 12 últimos), média simples de marcas e criadores. Faixas públicas <1K, 10K-50K, 500K-1M. faixas da fonte cruzam as nossas: interpolação linear em log10(seguidores) entre os pontos médios geométricos das faixas da fonte; faixa nossa fora do intervalo recebe os valores da faixa da ponta (ponto da faixa <1K = 316 seguidores)
  -- cortes: spread assumido (logit-normal sigma 0,8), centro = participação da fonte (interpolado entre PB 10K-50K e PB 500K-1M, t=0.667; spread assumido (logit 0.8))
  ('100k_plus', 'reels_share', '{0.209359,0.247738,0.274413,0.295616,0.313545,0.32926,0.343362,0.356229,0.368114,0.379198,0.389614,0.399463,0.408825,0.417762,0.426325,0.434558,0.442494,0.450165,0.457594,0.464806,0.471817,0.478646,0.485306,0.491812,0.498174,0.504402,0.510507,0.516497,0.52238,0.528162,0.53385,0.53945,0.544967,0.550407,0.555774,0.561073,0.566308,0.571482,0.5766,0.581664,0.586678,0.591645,0.596568,0.60145,0.606293,0.6111,0.615874,0.620616,0.625329,0.630016,0.634679,0.639319,0.643939,0.648541,0.653128,0.6577,0.662261,0.666812,0.671356,0.675894,0.680428,0.684962,0.689497,0.694035,0.698579,0.703132,0.707695,0.712272,0.716866,0.721478,0.726114,0.730775,0.735466,0.740191,0.744954,0.749759,0.754612,0.759518,0.764484,0.769517,0.774623,0.779813,0.785097,0.790485,0.795992,0.801635,0.80743,0.813403,0.819581,0.825998,0.832701,0.839747,0.847215,0.855215,0.863912,0.873563,0.884619,0.898008,0.91632}'::numeric[], '2026-11-25'::timestamptz, 'Playbook 2025: participação de Reels agregada por faixa; spread assumido')
on conflict (band, metric) do update
  set cuts = excluded.cuts, computed_at = excluded.computed_at, source_note = excluded.source_note;
-- ===== SEED DE MERCADO (fim) =====

-- -------------------------------------------------------------
-- 3. Chave: gravar referências do Mesaas (padrão desligada; liga só depois da
--    Política de Privacidade nova no ar)
-- -------------------------------------------------------------
insert into public.platform_settings (key, value)
values ('ig_peer_benchmarks_mesaas', '{"enabled": false}'::jsonb)
on conflict (key) do nothing;

-- -------------------------------------------------------------
-- 4. Refresh: por (faixa, métrica), mesaas com n >= 30 e chave ligada; senão a
--    linha de mercado (cópia exata); sem mercado, sem linha.
--    SECURITY DEFINER (dono postgres): lê contas de todos os workspaces, e só
--    cortes percentis agregados saem dela.
-- -------------------------------------------------------------
create or replace function public.ig_peer_benchmarks_refresh()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mesaas boolean;
  v_levels float8[] := array(select g / 100.0 from generate_series(1, 99) g);
begin
  -- Serializa execuções sobrepostas (a segunda espera a primeira); leitores seguem.
  lock table public.ig_peer_benchmarks in exclusive mode;

  -- Leitura estrita: só o booleano JSON true liga; valor malformado fica desligado sem erro.
  select coalesce((s.value -> 'enabled') = 'true'::jsonb, false)
    into v_mesaas
    from (select 1) one
    left join platform_settings s on s.key = 'ig_peer_benchmarks_mesaas';

  -- Recompõe a tabela inteira dentro desta chamada (uma transação): quem lê vê o
  -- conjunto antigo até o commit.
  delete from ig_peer_benchmarks where true;

  if v_mesaas then
    insert into ig_peer_benchmarks (band, metric, source, sample_size, cuts, computed_at)
    with eligible as (
      -- mesma conta IG em dois workspaces conta uma vez: fica a sincronizada por último
      select distinct on (ia.instagram_user_id)
             ia.id, ig_follower_band(ia.follower_count) as band
        from instagram_accounts ia
       where ia.follower_count > 0
         and ia.last_synced_at >= now() - interval '14 days'
       order by ia.instagram_user_id, ia.last_synced_at desc, ia.id
    ),
    vals as (
      select e.band, v.metric, v.value
        from eligible e
        cross join lateral ig_account_health_metrics(e.id) m
        cross join lateral (values
          ('engagement_rate', m.engagement_rate),
          ('posts_30d', m.posts_30d::numeric),
          ('reel_views', m.reel_views),
          ('reels_share', m.reels_share)
        ) as v(metric, value)
       where v.value is not null
    ),
    peer as (
      select band, metric, count(*)::int as n,
             percentile_cont(v_levels) within group (order by value::float8) as cuts
        from vals
       group by band, metric
      having count(*) >= 30  -- piso de privacidade e de amostra
    )
    select p.band, p.metric, 'mesaas', p.n, p.cuts::numeric[], now()
      from peer p
    union all
    select k.band, k.metric, 'mercado', null, k.cuts, k.computed_at
      from ig_peer_benchmarks_mercado k
     where not exists (select 1 from peer p where p.band = k.band and p.metric = k.metric);
  else
    -- Chave desligada: nenhuma métrica de conta é lida, só o mercado.
    insert into ig_peer_benchmarks (band, metric, source, sample_size, cuts, computed_at)
    select k.band, k.metric, 'mercado', null, k.cuts, k.computed_at
      from ig_peer_benchmarks_mercado k;
  end if;
end;
$$;

alter function public.ig_peer_benchmarks_refresh() owner to postgres;
revoke all on function public.ig_peer_benchmarks_refresh() from public, anon, authenticated;
grant execute on function public.ig_peer_benchmarks_refresh() to service_role;

-- -------------------------------------------------------------
-- 5. Cópia inicial: a página funciona antes da primeira execução do cron
-- -------------------------------------------------------------
select public.ig_peer_benchmarks_refresh();

-- -------------------------------------------------------------
-- 6. Cron diário 06:53 UTC (minuto 53 livre). Idempotente.
-- -------------------------------------------------------------
do $$ begin
  if exists (select 1 from cron.job where jobname = 'ig-peer-benchmarks-refresh') then
    perform cron.unschedule('ig-peer-benchmarks-refresh');
  end if;
end $$;

select cron.schedule(
  'ig-peer-benchmarks-refresh',
  '53 6 * * *',
  $$select public.ig_peer_benchmarks_refresh()$$
);
