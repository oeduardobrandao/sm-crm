import { useQuery } from '@tanstack/react-query';
import { getPostReferencesData, type ReferenceItem } from '@/store/postReferences';

// Same cache policy as ['post-media', post.id] (PostEditorBody): every refetch re-signs the R2
// URLs, which swaps every <img src> and re-downloads the thumbnails, so refetch rarely. The
// list still updates on delete (explicit invalidation), on reopening the drawer, and here.
const STALE_MS = 5 * 60 * 1000;
// Signed URLs live 3600s. Refetching every 45 minutes keeps an editor left open from serving
// expired thumbnails and download links. Side effect, accepted: a video playing in the viewer
// at that moment restarts, because its src is re-signed.
const REFRESH_SIGNED_URLS_MS = 45 * 60 * 1000;

/** The client's references for one post. One call per post editor (PostEditorBody), shared by
 *  the references section and the comment bubbles. */
const EMPTY_ITEMS: ReferenceItem[] = [];

export function usePostReferences(postId: number | null | undefined, enabled: boolean) {
  const query = useQuery({
    queryKey: ['post-references', postId],
    queryFn: () => getPostReferencesData(postId as number),
    enabled: enabled && postId != null,
    staleTime: STALE_MS,
    refetchInterval: REFRESH_SIGNED_URLS_MS,
  });
  return {
    ...query,
    references: query.data?.items ?? EMPTY_ITEMS,
    /** The post's "pedir material" request, folded into the same GET. */
    request: query.data?.request ?? null,
  };
}
