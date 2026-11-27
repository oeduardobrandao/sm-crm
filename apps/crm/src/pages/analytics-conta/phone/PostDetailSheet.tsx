import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BottomSheet } from '@/components/mobile/BottomSheet';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import { FormRow } from '@/components/mobile/FormRow';
import { InstagramLinkButton, hasInstagramLink } from '@/components/instagram/InstagramLinkButton';
import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';
import type { PostAnalytics, PostTag } from '../../../services/analytics';
import type { RateDistributions } from '../../../lib/ig-rates';
import { PostMetricsView } from '../components/PostMetricsView';

/**
 * The post metrics as a sheet (the phone face of PostMetricsDialog): the same Instagram-style
 * view, the Instagram link in the header next to Fechar, and the tags as toggles under
 * Visão geral.
 */
export function PostDetailSheet({
  clientId,
  post,
  onOpenChange,
  tags,
  onToggleTag,
  onNewTag,
  dists,
}: {
  clientId: number;
  post: PostAnalytics | null;
  onOpenChange: (open: boolean) => void;
  tags: PostTag[];
  onToggleTag: (post: PostAnalytics, tag: PostTag, assigned: boolean) => Promise<void>;
  onNewTag: () => void;
  dists?: RateDistributions;
}) {
  const { t } = useTranslation('analyticsAccount');
  // Keeps the last post while the sheet animates out.
  const [shown, setShown] = useState<PostAnalytics | null>(post);
  const [busyTag, setBusyTag] = useState<number | null>(null);
  const commentsEnabled = useWorkspaceLimits().features?.feature_instagram_comments_ai === true;
  useEffect(() => {
    if (post) setShown(post);
  }, [post]);

  const p = post ?? shown;
  if (!p) return null;

  const assigned = new Set(p.tags.map((tag) => tag.id));

  const tagsGroup = (
    <GroupedList header={t('tag.heading')}>
      {tags.length > 0 && (
        <li className="phone-cell">
          <div className="phone-an-tags" role="group" aria-label={t('tag.postTags')}>
            {tags.map((tag) => {
              const on = assigned.has(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  className="phone-an-tag"
                  aria-pressed={on}
                  disabled={busyTag !== null}
                  onClick={async () => {
                    setBusyTag(tag.id);
                    try {
                      await onToggleTag(p, tag, on);
                    } finally {
                      setBusyTag(null);
                    }
                  }}
                >
                  <span
                    className="phone-an-tag__dot"
                    style={{ background: tag.color }}
                    aria-hidden="true"
                  />
                  {tag.tag_name}
                </button>
              );
            })}
          </div>
        </li>
      )}
      <Cell icon={<Plus />} label={t('tag.new')} onClick={onNewTag} aria-haspopup="dialog" />
    </GroupedList>
  );

  return (
    <BottomSheet
      open={post !== null}
      onOpenChange={onOpenChange}
      title={t('pm.title')}
      detents={['large']}
      className="phone-an-sheet"
      headerTrailing={
        hasInstagramLink(p.permalink) ? <InstagramLinkButton permalink={p.permalink} /> : undefined
      }
      showClose
    >
      <div className="phone-an-sheet__body">
        <PostMetricsView
          post={p}
          clientId={clientId}
          dists={dists}
          commentsEnabled={commentsEnabled}
          variant="sheet"
          overviewFooter={tagsGroup}
        />
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
  const { t } = useTranslation('analyticsAccount');
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
      title={t('tag.new')}
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
        <GroupedList aria-label={t('tag.new')}>
          <FormRow
            label={t('tag.name')}
            helper={t('tag.example')}
            input={{
              value: name,
              autoFocus: true,
              maxLength: 40,
              placeholder: t('tag.namePlaceholder'),
              onChange: (e) => setName(e.target.value),
            }}
          />
        </GroupedList>
        <button type="submit" className="phone-an-primary-button" disabled={!name.trim() || saving}>
          {saving ? t('tag.creating') : t('tag.create')}
        </button>
      </form>
    </BottomSheet>
  );
}
