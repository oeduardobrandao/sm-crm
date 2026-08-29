import type { PostStatusDefinition, WorkflowPost } from '../../store';
import {
  POST_STATUS_ORDER,
  STATUS_LABELS,
  STATUS_CLASS,
  STATUS_OWNER,
  STATUS_OWNER_LABELS,
  STATUS_OWNER_ORDER,
  type StatusOwner,
} from './postLabels';

// The dynamic status registry: the 9 canonical statuses (from postLabels,
// which stays the single source for them) merged with the workspace's custom
// status definitions. Custom statuses are keyed 'custom:<uuid>' so they can
// travel through the same select values, filter arrays and URL params as the
// canonical string statuses without colliding with them.

export type StatusKey = WorkflowPost['status'] | `custom:${string}`;

export interface StatusOption {
  key: StatusKey;
  kind: 'canonical' | 'custom';
  /** Definition id, only for kind 'custom'. */
  customId?: string;
  /** The canonical status driving behavior: behaves_as for customs, itself otherwise. */
  canonical: WorkflowPost['status'];
  label: string;
  /** Badge CSS class, canonical statuses only. */
  cssClass?: string;
  /** User-picked hex color, customs only. */
  color?: string;
}

export interface StatusRegistry {
  /** Canonical pipeline order with customs inserted right after their anchor. */
  options: StatusOption[];
  byKey: Map<StatusKey, StatusOption>;
  hasCustom: boolean;
  /** Effective option for a post; falls back to the canonical status when the
   * pointer is missing, unknown or archived (registry only holds live defs). */
  resolve(post: ResolvablePost): StatusOption;
}

export type ResolvablePost = Pick<WorkflowPost, 'status'> & {
  custom_status_id?: string | null;
};

export const customKey = (id: string): StatusKey => `custom:${id}`;

const CUSTOM_KEY_RE = /^custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Valid StatusKey token for URL parsing: a canonical status or custom:<uuid>. */
export function isStatusKeyToken(value: string): value is StatusKey {
  return (POST_STATUS_ORDER as readonly string[]).includes(value) || CUSTOM_KEY_RE.test(value);
}

export function buildStatusRegistry(defs: PostStatusDefinition[]): StatusRegistry {
  const byAnchor = new Map<WorkflowPost['status'], PostStatusDefinition[]>();
  for (const def of defs) {
    if (def.arquivado) continue;
    const list = byAnchor.get(def.behaves_as) ?? [];
    list.push(def);
    byAnchor.set(def.behaves_as, list);
  }
  for (const list of byAnchor.values()) {
    list.sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome));
  }

  const options: StatusOption[] = [];
  for (const status of POST_STATUS_ORDER) {
    options.push({
      key: status,
      kind: 'canonical',
      canonical: status,
      label: STATUS_LABELS[status],
      cssClass: STATUS_CLASS[status],
    });
    for (const def of byAnchor.get(status) ?? []) {
      options.push({
        key: customKey(def.id),
        kind: 'custom',
        customId: def.id,
        canonical: def.behaves_as,
        label: def.nome,
        color: def.cor,
      });
    }
  }

  const byKey = new Map(options.map((o) => [o.key, o]));

  return {
    options,
    byKey,
    hasCustom: options.length > POST_STATUS_ORDER.length,
    resolve(post) {
      if (post.custom_status_id) {
        const opt = byKey.get(customKey(post.custom_status_id));
        if (opt) return opt;
      }
      return byKey.get(post.status)!;
    },
  };
}

/**
 * The write contract for status picks. A custom pick sends only the pointer —
 * the z1 DB trigger forces `status` to the definition's behaves_as. A
 * canonical pick always sends `custom_status_id: null` explicitly: the null is
 * what distinguishes "remove the custom status" from a status write that
 * didn't think about it.
 */
export function statusKeyToPatch(
  key: StatusKey,
): Pick<WorkflowPost, 'custom_status_id'> & Partial<Pick<WorkflowPost, 'status'>> {
  if (key.startsWith('custom:')) {
    return { custom_status_id: key.slice('custom:'.length) };
  }
  return { status: key as WorkflowPost['status'], custom_status_id: null };
}

/**
 * Whether picking `key` for `post` needs the "post aprovado" confirm dialog
 * first. Only approved posts (`aprovado_interno`/`aprovado_cliente`) guard at
 * all, and only when the pick actually changes the effective canonical status
 * — moving an approved post into a custom status that behaves as the same
 * canonical keeps the approval intact, so no confirmation is needed there.
 *
 * Single source for the guard: WorkflowDrawer's status picker and the
 * Publicações kanban's drag-and-drop both call this instead of re-deriving
 * "is this an approval-invalidating move" on their own.
 */
export function statusChangeNeedsConfirm(
  post: ResolvablePost | null | undefined,
  key: StatusKey,
  registry: StatusRegistry,
): boolean {
  if (!post) return false;
  const isApproved = post.status === 'aprovado_interno' || post.status === 'aprovado_cliente';
  if (!isApproved) return false;
  const nextCanonical = registry.byKey.get(key)?.canonical ?? post.status;
  return nextCanonical !== post.status;
}

/**
 * Filter predicate for the "Status do post" multi-select. A canonical key
 * matches on the canonical column (so posts sitting in a custom status that
 * behaves as it are included — canonical is the DB truth); a custom key
 * matches only that pointer.
 */
export function postMatchesStatusFilter(post: ResolvablePost, keys: StatusKey[]): boolean {
  return keys.some((key) =>
    key.startsWith('custom:')
      ? post.custom_status_id === key.slice('custom:'.length)
      : post.status === key,
  );
}

/**
 * Partition the registry's options into the picker's `<optgroup>`s, preserving
 * each group's pipeline order. A custom status inherits its anchor's owner —
 * one that behaves as `postado` is written by the cron just like `postado` is.
 *
 * Only groups that actually have options are returned, so a workspace whose
 * customs all hang off `equipe` anchors never renders an empty heading.
 */
export function groupOptionsByOwner(
  options: StatusOption[],
): { owner: StatusOwner; label: string; options: StatusOption[] }[] {
  return STATUS_OWNER_ORDER.map((owner) => ({
    owner,
    label: STATUS_OWNER_LABELS[owner],
    options: options.filter((o) => STATUS_OWNER[o.canonical] === owner),
  })).filter((g) => g.options.length > 0);
}
