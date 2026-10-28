import { Fragment, useState } from 'react';
import { ChevronRight, Eye, Film, MessageCircle, Plus, Trash2 } from 'lucide-react';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import { BarList } from '@/components/mobile/BarList';
import { StatCard } from '@/components/StatCard';
import { StatCardGrid } from '@/components/StatCardGrid';
import { cn } from '@/lib/utils';
import type {
  AudienceDemographics,
  BestPostingTimes,
  PostAnalytics,
  PostTag,
  StoriesAnalyticsResponse,
} from '../../../services/analytics';
import { formatRate, IG_RATE_WEIGHTS, type Baseline, type RateKey } from '../../../lib/ig-rates';
import { BEST_TIME_BUCKET_STARTS, bucketBestTimes, toStatDelta } from '../contaFormat';
import { fmtNumber } from '../../analytics/phone/shared';
import { priorityTone, type AIAnalysisView } from '../../analytics/phone/AIAnalysisPhone';

export const formatPct = (v: number) => v.toFixed(1).replace('.', ',');

const fmtDay = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

export const DAY_FULL: Record<string, string> = {
  Seg: 'Segunda',
  Ter: 'Terça',
  Qua: 'Quarta',
  Qui: 'Quinta',
  Sex: 'Sexta',
  Sab: 'Sábado',
  Sáb: 'Sábado',
  Dom: 'Domingo',
};

/* ---------------- Follower growth ---------------- */

/**
 * The follower line chart as compact columns: the latest count, the change over the
 * window, and tap-a-bar for a day's value (a canvas tooltip on desktop).
 */
export function FollowerGrowthCard({
  history,
  onManual,
  title = 'Crescimento de seguidores',
  emptyText = 'Dados insuficientes. O histórico é construído diariamente.',
}: {
  history: { date: string; follower_count: number; source: string }[];
  /** Omit where the platform takes no manual count (TikTok). */
  onManual?: () => void;
  title?: string;
  emptyText?: string;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const manualButton = onManual ? (
    <button type="button" className="phone-text-button" onClick={onManual}>
      Inserir manualmente
    </button>
  ) : (
    <span />
  );

  if (history.length < 2) {
    return (
      <section className="phone-an-card" aria-labelledby="conta-followers-title">
        <div className="phone-an-card__top">
          <h2 id="conta-followers-title" className="phone-group__header">
            {title}
          </h2>
        </div>
        <p className="phone-an-card__readout">{emptyText}</p>
        {onManual && (
          <div className="phone-an-card__bottom">
            <span />
            {manualButton}
          </div>
        )}
      </section>
    );
  }

  const points = history.slice(-30);
  const first = history[0];
  const last = history[history.length - 1];
  const delta = last.follower_count - first.follower_count;
  const values = points.map((p) => p.follower_count);
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const pickedPoint = picked !== null ? points[picked] : null;

  return (
    <section className="phone-an-card" aria-labelledby="conta-followers-title">
      <div className="phone-an-card__top">
        <h2 id="conta-followers-title" className="phone-group__header">
          {title}
        </h2>
      </div>
      <div className="phone-an-card__top">
        <span className="phone-an-card__big">{fmtNumber(last.follower_count)}</span>
        <span
          className={cn(
            'phone-an-card__delta',
            delta > 0
              ? 'phone-an-tone--up'
              : delta < 0
                ? 'phone-an-tone--down'
                : 'phone-an-tone--muted',
          )}
        >
          {delta > 0 ? '+' : ''}
          {fmtNumber(delta)} no período
        </span>
      </div>
      <div className="phone-an-spark" role="group" aria-label="Seguidores por dia">
        {points.map((p, i) => (
          <button
            key={p.date}
            type="button"
            className={cn(
              'phone-an-spark__bar',
              i === points.length - 1 && picked === null && 'phone-an-spark__bar--last',
            )}
            style={{ height: `${15 + ((p.follower_count - min) / span) * 85}%` }}
            aria-pressed={picked === i}
            aria-label={`${fmtDay(p.date)}: ${fmtNumber(p.follower_count)} seguidores`}
            onClick={() => setPicked(picked === i ? null : i)}
          />
        ))}
      </div>
      <p className="phone-an-card__readout" aria-live="polite">
        {pickedPoint
          ? `${fmtDay(pickedPoint.date)}: ${fmtNumber(pickedPoint.follower_count)} seguidores${pickedPoint.source === 'manual' ? ' (manual)' : ''}`
          : 'Toque numa barra para ver o dia.'}
      </p>
      <div className="phone-an-card__bottom">
        <span>
          {fmtDay(points[0].date)} a {fmtDay(last.date)}
        </span>
        {manualButton}
      </div>
    </section>
  );
}

/* ---------------- Demographics ---------------- */

export function DemographicsSection({ data }: { data: AudienceDemographics | null }) {
  if (!data) {
    return (
      <p className="phone-an-empty">
        Dados demográficos indisponíveis. A conta pode não ter seguidores suficientes ou a permissão
        instagram_manage_insights pode estar ausente.
      </p>
    );
  }
  const groups = data.age_gender;
  const total = groups.reduce((s, a) => s + a.male + a.female, 0);
  const cities = data.cities.slice(0, 5);
  return (
    <>
      <GroupedList header="Gênero">
        <Cell label="Feminino" value={`${data.gender_split.female}%`} />
        <Cell label="Masculino" value={`${data.gender_split.male}%`} />
      </GroupedList>
      {groups.length > 0 && (
        <BarList
          header="Faixa etária"
          color="var(--an-female)"
          secondaryColor="var(--an-male)"
          items={groups.map((a) => ({
            key: a.age_range,
            label: a.age_range,
            value: a.female,
            valueLabel:
              total > 0
                ? `${Math.round(((a.male + a.female) / total) * 100)}% do público`
                : fmtNumber(a.male + a.female),
            secondary: a.male,
            subtitle: `Mulheres ${fmtNumber(a.female)} · Homens ${fmtNumber(a.male)}`,
          }))}
          footer="Barra rosa: mulheres. Barra azul: homens."
        />
      )}
      {cities.length > 0 && (
        <BarList
          header="Principais cidades"
          items={cities.map((c) => {
            const [name, region] = c.name.split(/,\s*/, 2);
            return {
              key: c.name,
              label: name,
              subtitle: region,
              value: c.count,
              valueLabel: fmtNumber(c.count),
            };
          })}
        />
      )}
    </>
  );
}

/* ---------------- Best times ---------------- */

/** Wording of the best-times section; a platform with other units (TikTok) overrides it. */
export interface BestTimesLabels {
  /** Fewer than 5 posts/videos. */
  empty: string;
  /** Readout before a cell is picked. */
  tapHint: string;
  header: string;
  footer: (bucketHours: number) => string;
  heatmapAria: string;
  /** A slot with nothing posted. `day` is short in the cell label, full in the readout. */
  emptySlot: (day: string, hour: number) => string;
  cellAria: (day: string, hour: number, value: number, count: number) => string;
  readout: (day: string, from: number, to: number, value: number, count: number) => string;
  recommended: string;
  slotLabel: (day: string, hour: string) => string;
  slotValue: (value: number, count: number) => string;
}

const posts = (n: number) => `${n} post${n !== 1 ? 's' : ''}`;

const INSTAGRAM_BEST_TIMES: BestTimesLabels = {
  empty:
    'Dados insuficientes. São necessários pelo menos 5 posts nos últimos 90 dias para análise.',
  tapHint: 'Toque num horário para ver o engajamento.',
  header: 'Engajamento por dia e horário',
  footer: (h) =>
    `Média de engajamento por faixa de ${h}h, horário de Brasília. Mais escuro, mais engajamento.`,
  heatmapAria: 'Mapa de calor de horários',
  emptySlot: (day, hour) => `${day} ${hour}h: sem posts`,
  cellAria: (day, hour, value, count) =>
    `${day} ${hour}h: ${formatPct(value)}% de engajamento, ${posts(count)}`,
  readout: (day, from, to, value, count) =>
    `${day} ${from}h a ${to}h: ${formatPct(value)}% eng. (${posts(count)})`,
  recommended: 'Horários recomendados',
  slotLabel: (day, hour) => `${day} às ${hour}`,
  slotValue: (value, count) => `${formatPct(value)}% eng. · ${count} post${count > 1 ? 's' : ''}`,
};

export function BestTimesSection({
  data,
  labels = INSTAGRAM_BEST_TIMES,
}: {
  data: BestPostingTimes | null;
  labels?: BestTimesLabels;
}) {
  const [picked, setPicked] = useState<{ d: number; b: number } | null>(null);
  if (!data || data.totalPosts < 5) {
    return <p className="phone-an-empty">{labels.empty}</p>;
  }
  const { buckets, bucketSize, max, topCell } = bucketBestTimes(data);
  const readout = (() => {
    const cell = picked ?? (topCell ? { d: topCell.day, b: topCell.bucket } : null);
    if (!cell) return labels.tapHint;
    const c = buckets[cell.d]?.[cell.b];
    const day = data.labels_days[cell.d];
    const start = BEST_TIME_BUCKET_STARTS[cell.b];
    if (!c || c.count === 0) return labels.emptySlot(DAY_FULL[day] ?? day, start);
    return labels.readout(DAY_FULL[day] ?? day, start, start + bucketSize - 1, c.value, c.count);
  })();

  return (
    <>
      <GroupedList header={labels.header} footer={labels.footer(bucketSize)}>
        <li className="phone-cell">
          <div className="phone-an-hm" role="group" aria-label={labels.heatmapAria}>
            <span />
            {BEST_TIME_BUCKET_STARTS.map((h) => (
              <span key={h} className="phone-an-hm__label">
                {h}h
              </span>
            ))}
            {data.labels_days.map((day, d) => (
              <Fragment key={day}>
                <span className="phone-an-hm__label">{day}</span>
                {buckets[d].map((cell, b) => {
                  const step = cell.value > 0 ? 1 + Math.round((cell.value / max) * 7) : 0;
                  const isTop = topCell !== null && topCell.day === d && topCell.bucket === b;
                  const isPicked = picked?.d === d && picked?.b === b;
                  return (
                    <button
                      key={b}
                      type="button"
                      className={cn(
                        'phone-an-hm__cell',
                        isTop && !picked && 'phone-an-hm__cell--top',
                      )}
                      style={{ background: `var(--an-heat-${Math.min(step, 8)})` }}
                      aria-pressed={isPicked}
                      aria-label={
                        cell.count > 0
                          ? labels.cellAria(day, BEST_TIME_BUCKET_STARTS[b], cell.value, cell.count)
                          : labels.emptySlot(day, BEST_TIME_BUCKET_STARTS[b])
                      }
                      onClick={() => setPicked(isPicked ? null : { d, b })}
                    />
                  );
                })}
              </Fragment>
            ))}
          </div>
          <p className="phone-an-readout" aria-live="polite">
            {readout}
          </p>
        </li>
      </GroupedList>
      {data.topSlots.length > 0 && (
        <GroupedList header={labels.recommended}>
          {data.topSlots.map((s, i) => (
            <Cell
              key={i}
              icon={<span className="phone-an-rank">{i + 1}</span>}
              label={labels.slotLabel(
                DAY_FULL[data.labels_days[s.day]] ?? data.labels_days[s.day],
                data.labels_hours[s.hour],
              )}
              value={labels.slotValue(s.value, s.postCount)}
            />
          ))}
        </GroupedList>
      )}
    </>
  );
}

/* ---------------- Saves ---------------- */

export function SavesSection({ posts }: { posts: PostAnalytics[] }) {
  return (
    <>
      <p className="phone-an-sheet__summary">
        Salvamentos indicam que alguém guardou o conteúdo para uma decisão de saúde. É a métrica
        mais subestimada para conteúdo médico.
      </p>
      <GroupedList aria-label="Posts mais salvos">
        {posts.map((p) => (
          <Cell
            key={p.id}
            label={p.caption || 'Sem legenda'}
            subtitle={`${formatPct(p.saves_rate)}% taxa de salvamento`}
            value={`${fmtNumber(p.saved)} salv.`}
          />
        ))}
      </GroupedList>
    </>
  );
}

/* ---------------- Type + topic ---------------- */

export function TypeTopicSection({
  typeBreakdown,
  topicStats,
  tags,
  days,
  onRemoveTag,
  onNewTag,
}: {
  typeBreakdown: { type: string; count: number; avgEngagement: number }[];
  topicStats: (PostTag & { avgEngagement: number; count: number })[];
  tags: PostTag[];
  days: number;
  onRemoveTag: (tag: PostTag) => void;
  onNewTag: () => void;
}) {
  return (
    <>
      {typeBreakdown.length === 0 ? (
        <p className="phone-an-empty">Sem dados.</p>
      ) : (
        <BarList
          header="Desempenho por tipo"
          footer={`Engajamento médio · últimos ${days} dias`}
          items={typeBreakdown.map((t) => ({
            key: t.type,
            label: t.type,
            subtitle: `${t.count} post${t.count !== 1 ? 's' : ''}`,
            value: t.avgEngagement,
            valueLabel: `${formatPct(t.avgEngagement)}%`,
          }))}
        />
      )}
      {topicStats.length > 0 ? (
        <BarList
          header="Desempenho por tópico"
          items={topicStats.map((t) => ({
            key: String(t.id),
            label: t.tag_name,
            subtitle: `${t.count} post${t.count !== 1 ? 's' : ''}`,
            value: t.avgEngagement,
            valueLabel: `${t.avgEngagement.toFixed(2).replace('.', ',')}%`,
            color: t.color,
          }))}
        />
      ) : (
        <p className="phone-an-sheet__summary">
          {tags.length === 0
            ? 'Crie tags e atribua aos posts para descobrir quais temas engajam mais.'
            : 'Atribua tags aos posts para ver o desempenho por tópico.'}
        </p>
      )}
      <GroupedList
        header="Tags"
        footer={
          tags.length > 0
            ? 'Atribua tags na ficha de cada post, em Performance de conteúdo.'
            : undefined
        }
      >
        {tags.map((t) => (
          <Cell
            key={t.id}
            icon={<span className="phone-an-tag__dot" style={{ background: t.color }} />}
            label={t.tag_name}
            accessory={<Trash2 aria-hidden="true" className="phone-an-tone--muted" />}
            aria-label={`Remover a tag ${t.tag_name}`}
            aria-haspopup="dialog"
            onClick={() => onRemoveTag(t)}
          />
        ))}
        <Cell icon={<Plus />} label="Nova tag" aria-haspopup="dialog" onClick={onNewTag} />
      </GroupedList>
    </>
  );
}

/* ---------------- Stories ---------------- */

export function StoriesSectionPhone({ data }: { data: StoriesAnalyticsResponse }) {
  const { current, previous } = data.kpis;
  return (
    <>
      <StatCardGrid maxCols={4}>
        <StatCard
          label="Stories publicados"
          value={current.stories_count}
          icon={Film}
          tone="blue"
          delta={toStatDelta(current.stories_count, previous?.stories_count)}
        />
        <StatCard
          label="Alcance de Stories"
          value={fmtNumber(current.total_reach)}
          icon={Eye}
          tone="violet"
          delta={toStatDelta(current.total_reach, previous?.total_reach)}
        />
        <StatCard
          label="Taxa de retenção"
          value={`${(current.avg_retention_rate * 100).toFixed(1)}%`}
          icon={ChevronRight}
          tone="green"
          delta={toStatDelta(current.avg_retention_rate, previous?.avg_retention_rate)}
        />
        <StatCard
          label="Respostas"
          value={current.total_replies}
          icon={MessageCircle}
          tone="pink"
          delta={toStatDelta(current.total_replies, previous?.total_replies)}
        />
      </StatCardGrid>
      {data.stories.length > 0 && (
        <GroupedList header="Detalhamento por story" footer="Valor à direita: taxa de retenção.">
          {data.stories.map((s) => {
            const tone = s.retention_rate > 0.7 ? 'up' : s.retention_rate > 0.5 ? 'warn' : 'down';
            return (
              <Cell
                key={s.instagram_media_id}
                label={new Date(s.posted_at).toLocaleDateString('pt-BR', {
                  day: '2-digit',
                  month: 'short',
                })}
                subtitle={
                  <span className="phone-an-cell-sub phone-an-cell-sub--wrap">
                    Alcance {fmtNumber(s.reach)} · Impressões {fmtNumber(s.impressions)} · Avançaram{' '}
                    {s.taps_forward} · Voltaram {s.taps_back} · Saídas {s.exits} · Respostas{' '}
                    {s.replies}
                  </span>
                }
                value={
                  <span className={`phone-an-badge phone-an-badge--${tone}`}>
                    {(s.retention_rate * 100).toFixed(1)}%
                  </span>
                }
              />
            );
          })}
        </GroupedList>
      )}
    </>
  );
}

/* ---------------- Baseline ---------------- */

const RATE_STRIP_LABELS: Record<RateKey, string> = {
  share_rate: 'Compartilhamentos',
  like_rate: 'Curtidas',
  save_rate: 'Salvos',
  comment_rate: 'Comentários',
};
const FORMAT_LABELS: Record<string, string> = {
  VIDEO: 'Reels',
  CAROUSEL_ALBUM: 'Carrossel',
  IMAGE: 'Imagem',
};

export function BaselineSection({ baseline }: { baseline: Baseline }) {
  return (
    <GroupedList
      header={`Histórico completo · ${baseline.sample_size} posts · por visualização`}
      footer="Heurística interna alinhada ao IG (compart. > curt. > salvos > coment.), não são os pesos oficiais do Instagram. Taxa de skip e repost não estão na API. Pontuado vs. o histórico completo do cliente, igual ao que o agente vê."
    >
      {(['share_rate', 'like_rate', 'save_rate', 'comment_rate'] as RateKey[]).map((key) => {
        const q = baseline.overall[key].quartiles;
        const scaleMax = q ? (q.p75 || 0) * 1.5 || 1 : 1;
        const pct = (v: number) => Math.max(0, Math.min(100, (v / scaleMax) * 100));
        const perFormat = Object.entries(baseline.by_format)
          .map(([fmt, m]) => {
            const fq = m[key].quartiles;
            return `${FORMAT_LABELS[fmt] ?? fmt} ${fq ? formatRate(fq.p50) : 'n<5'}`;
          })
          .join(' · ');
        return (
          <li key={key} className="phone-cell">
            <div className="phone-an-strip-rate">
              <div className="phone-an-strip-rate__top">
                <span>
                  <strong>{RATE_STRIP_LABELS[key]}</strong>{' '}
                  <span className="phone-an-tone--muted">
                    peso {Math.round(IG_RATE_WEIGHTS[key] * 100)}%
                  </span>
                </span>
                <span>
                  <strong>{q ? formatRate(q.p50) : 'Sem dado'}</strong>{' '}
                  <span className="phone-an-tone--muted">mediana</span>
                </span>
              </div>
              <div className="phone-an-strip-rate__track" aria-hidden="true">
                {q && (
                  <>
                    <span
                      className="phone-an-strip-rate__band"
                      style={{
                        left: `${pct(q.p25)}%`,
                        width: `${Math.max(0, pct(q.p75) - pct(q.p25))}%`,
                      }}
                    />
                    <span
                      className="phone-an-strip-rate__median"
                      style={{ left: `${pct(q.p50)}%` }}
                    />
                  </>
                )}
              </div>
              <div className="phone-an-strip-rate__meta">
                {q
                  ? `p25 ${formatRate(q.p25)} · p75 ${formatRate(q.p75)} · `
                  : 'Amostra insuficiente · '}
                {perFormat}
              </div>
            </div>
          </li>
        );
      })}
    </GroupedList>
  );
}

/* ---------------- AI ---------------- */

const titleCase = (key: string) => {
  const spaced = key.replace(/([A-Z])/g, ' $1');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

/** Section titles a platform renames (TikTok: "Melhor vídeo", "Diagnóstico de títulos"). */
export interface ContaAILabels {
  topPerformer: string;
  worstPerformer: string;
  captionDiagnostic: string;
}

const CONTA_AI_LABELS: ContaAILabels = {
  topPerformer: 'Melhor post',
  worstPerformer: 'Pior post',
  captionDiagnostic: 'Diagnóstico de legendas',
};

/** The account analysis payload (untyped JSON) in the shared phone shape. */
export function contaAIView(
  a: any,
  labels: ContaAILabels = CONTA_AI_LABELS,
): AIAnalysisView | null {
  if (!a) return null;
  return {
    score: a.healthScore
      ? {
          value: a.healthScore.score ?? 0,
          label: 'Health Score',
          summary: String(a.healthScore.summary ?? ''),
        }
      : undefined,
    facts: a.healthScore?.breakdown
      ? Object.entries(a.healthScore.breakdown).map(([key, val]) => ({
          label: titleCase(key),
          value: typeof val === 'string' ? val : val === null ? 'N/A' : String(val),
        }))
      : undefined,
    sections: [
      { title: labels.topPerformer, text: a.performanceMap?.topPerformer },
      { title: labels.worstPerformer, text: a.performanceMap?.worstPerformer },
      { title: 'Mix de conteúdo', text: a.performanceMap?.contentMix },
      { title: labels.captionDiagnostic, text: a.captionDiagnostic },
      { title: 'Trajetória de crescimento', text: a.growthAnalysis?.trajectory },
      { title: 'Projeção', text: a.growthAnalysis?.projection },
    ],
    actions: Array.isArray(a.actionPlan)
      ? {
          title: 'Plano de ação',
          items: a.actionPlan.map((p: any) => ({
            badge: String(p.prioridade ?? ''),
            tone: priorityTone(p.prioridade),
            title: String(p.acao ?? ''),
            detail: p.porque ? String(p.porque) : undefined,
          })),
        }
      : undefined,
    generatedAt: a.generatedAt,
  };
}
