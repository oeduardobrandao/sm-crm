import { useEffect, useState } from 'react';
import { ExternalLink, Plus } from 'lucide-react';
import { BottomSheet } from '@/components/mobile/BottomSheet';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import { FormRow } from '@/components/mobile/FormRow';
import type { PostAnalytics, PostTag } from '../../../services/analytics';
import { missingActionMetricTitle, type ActionMetricKey } from '../../../lib/post-action-metrics';
import { sanitizeUrl } from '../../../utils/security';
import { TextCell, ValueTile, fmtNumber, mediaTypeLabel } from '../../analytics/phone/shared';

const ACTION_LABELS: Record<ActionMetricKey, string> = {
  profile_visits: 'Visitas ao perfil',
  follows: 'Novos seguidores',
  bio_link_clicks: 'Toques no link da bio',
};

const fmtEng = (v: number) => `${v.toFixed(1).replace('.', ',')}%`;

/**
 * The expanded row of the posts table as a sheet (FAnalyticsPost): caption, the numbers
 * Instagram's own "Post insights" shows, why a metric is missing (a hover title on
 * desktop), the Instagram link and the tags as toggles.
 */
export function PostDetailSheet({
  post,
  onOpenChange,
  tags,
  onToggleTag,
  onNewTag,
}: {
  post: PostAnalytics | null;
  onOpenChange: (open: boolean) => void;
  tags: PostTag[];
  onToggleTag: (post: PostAnalytics, tag: PostTag, assigned: boolean) => Promise<void>;
  onNewTag: () => void;
}) {
  // Keeps the last post while the sheet animates out.
  const [shown, setShown] = useState<PostAnalytics | null>(post);
  const [busyTag, setBusyTag] = useState<number | null>(null);
  useEffect(() => {
    if (post) setShown(post);
  }, [post]);

  const p = post ?? shown;
  if (!p) return null;

  const actionKeys = Object.keys(ACTION_LABELS) as ActionMetricKey[];
  const missing = actionKeys.filter((k) => typeof p[k] !== 'number');
  const follows = p.follows;
  const reachPerFollower =
    typeof follows === 'number' && follows > 0 && p.reach > 0
      ? Math.max(1, Math.round(p.reach / follows))
      : null;
  const notes = [
    reachPerFollower !== null
      ? `1 novo seguidor a cada ${fmtNumber(reachPerFollower)} contas alcançadas.`
      : null,
    ...missing.map(
      (k) =>
        `${ACTION_LABELS[k]}: ${missingActionMetricTitle(k, p.unavailable_metrics, p.media_type)}.`,
    ),
  ].filter(Boolean);

  const assigned = new Set(p.tags.map((t) => t.id));

  return (
    <BottomSheet
      open={post !== null}
      onOpenChange={onOpenChange}
      title={`Post de ${new Date(p.posted_at).toLocaleDateString('pt-BR')}`}
      detents={['large']}
      className="phone-an-sheet"
    >
      <div className="phone-an-sheet__body">
        <GroupedList aria-label="Legenda">
          <Cell
            label={mediaTypeLabel(p.media_type)}
            value={
              p.ig_score === null || p.ig_score === undefined
                ? 'IG Score: amostra insuficiente (<5)'
                : `IG Score ${p.ig_score}`
            }
          />
          <TextCell>
            <p>{p.caption || 'Sem legenda'}</p>
          </TextCell>
        </GroupedList>

        <div className="phone-an-tiles">
          <ValueTile label="Visualizações" value={fmtNumber(p.views)} />
          <ValueTile label="Alcance" value={fmtNumber(p.reach)} />
          <ValueTile label="Engajamento" value={fmtEng(p.engagement_rate)} />
        </div>

        <h3 className="phone-group__header">Interações</h3>
        <div className="phone-an-tiles phone-an-tiles--4">
          <ValueTile label="Curtidas" value={fmtNumber(p.likes)} />
          <ValueTile label="Comentários" value={fmtNumber(p.comments)} />
          <ValueTile label="Compart." value={fmtNumber(p.shares)} />
          <ValueTile label="Salvamentos" value={fmtNumber(p.saved)} />
        </div>

        <h3 className="phone-group__header">Ações após a visualização</h3>
        <div className="phone-an-tiles">
          {actionKeys.map((k) => {
            const v = p[k];
            return (
              <ValueTile
                key={k}
                label={ACTION_LABELS[k]}
                value={typeof v === 'number' ? fmtNumber(v) : null}
              />
            );
          })}
        </div>
        {notes.length > 0 && <p className="phone-an-footnote">{notes.join(' ')}</p>}

        <GroupedList aria-label="Instagram">
          <li className="phone-cell">
            <a
              href={sanitizeUrl(p.permalink)}
              target="_blank"
              rel="noopener noreferrer"
              className="phone-cell__main"
            >
              <span className="phone-cell__icon" aria-hidden="true">
                <ExternalLink />
              </span>
              <span className="phone-cell__body">
                <span className="phone-cell__text">
                  <span className="phone-cell__label">Ver no Instagram</span>
                </span>
              </span>
            </a>
          </li>
        </GroupedList>

        <GroupedList header="Tags">
          {tags.length > 0 && (
            <li className="phone-cell">
              <div className="phone-an-tags" role="group" aria-label="Tags do post">
                {tags.map((t) => {
                  const on = assigned.has(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className="phone-an-tag"
                      aria-pressed={on}
                      disabled={busyTag !== null}
                      onClick={async () => {
                        setBusyTag(t.id);
                        try {
                          await onToggleTag(p, t, on);
                        } finally {
                          setBusyTag(null);
                        }
                      }}
                    >
                      <span
                        className="phone-an-tag__dot"
                        style={{ background: t.color }}
                        aria-hidden="true"
                      />
                      {t.tag_name}
                    </button>
                  );
                })}
              </div>
            </li>
          )}
          <Cell icon={<Plus />} label="Nova tag" onClick={onNewTag} aria-haspopup="dialog" />
        </GroupedList>
      </div>
    </BottomSheet>
  );
}

/** "Nova tag" without `prompt()`: a small sheet with the name and an explicit Criar. */
export function NewTagSheet({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Resolves true when the tag was created (the sheet then closes). */
  onCreate: (name: string) => Promise<boolean>;
}) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) setName('');
  }, [open]);
  const submit = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      if (await onCreate(name.trim())) onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Nova tag"
      detents={['fit']}
      className="phone-an-sheet"
    >
      <form
        className="phone-an-custom-sheet__body"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <GroupedList aria-label="Nova tag">
          <FormRow
            label="Nome"
            helper="Ex: Educativo, Procedimento, Bastidores"
            input={{
              value: name,
              autoFocus: true,
              maxLength: 40,
              placeholder: 'Nome da tag',
              onChange: (e) => setName(e.target.value),
            }}
          />
        </GroupedList>
        <button type="submit" className="phone-an-primary-button" disabled={!name.trim() || saving}>
          {saving ? 'Criando…' : 'Criar tag'}
        </button>
      </form>
    </BottomSheet>
  );
}
