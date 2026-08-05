import type { WorkflowPost } from '../../../store';
import { getPostPublishState, PUBLISH_STATE_LABELS, PUBLISH_STATE_CLASS } from '../postLabels';
import type { StatusRegistry } from '../statusRegistry';

type ChipPost = Pick<WorkflowPost, 'status'> & {
  custom_status_id?: string | null;
  scheduled_at?: string | null;
  platform?: WorkflowPost['platform'];
  tiktok_publish_status?: WorkflowPost['tiktok_publish_status'];
};

/**
 * The one status badge. Custom statuses render with the definition's color
 * (same inline pattern as PropertyValue's select options); canonical statuses
 * keep the existing CSS classes and the derived "publicando" state. A post
 * carrying a custom status is never agendado (z1 clears the pointer on
 * machine transitions), so the two branches cannot disagree.
 */
export function PostStatusChip({ post, registry }: { post: ChipPost; registry: StatusRegistry }) {
  const opt = registry.resolve(post);
  if (opt.kind === 'custom') {
    return (
      <span
        className="post-status-chip"
        style={{
          background: `${opt.color}22`,
          color: opt.color,
          border: `1px solid ${opt.color}55`,
        }}
      >
        {opt.label}
      </span>
    );
  }
  const pubState = getPostPublishState(post);
  return (
    <span className={`post-status-chip ${PUBLISH_STATE_CLASS[pubState]}`}>
      {PUBLISH_STATE_LABELS[pubState]}
    </span>
  );
}
