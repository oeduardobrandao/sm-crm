import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { getPostContentVersions, type PostApproval, type PostStatusEvent } from '../../../store';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ReadOnlyTipTap } from './ReadOnlyTipTap';
import { DiffView } from './DiffView';
import { computeWordDiff } from '@/utils/textDiff';
import { computeTipTapDiff } from '@/utils/tiptapDiff';
import { extractR2Keys, injectSignedUrls, resolveInlineImageUrls } from '@/services/inlineImage';
import {
  buildVersionTimeline,
  findPrecedingVersion,
  type VersionTimelineNode,
} from './postVersionTimeline';

interface PostVersionHistorySheetProps {
  postId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  statusEvents: PostStatusEvent[];
  approvals: PostApproval[];
}

function actorLabelFor(source: 'workspace_user' | 'client' | 'system', actorName: string | null) {
  if (source === 'client') return 'Cliente';
  if (source === 'system') return 'Sistema';
  return actorName ?? '—';
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "14:20–14:24" when the range falls on the same day, otherwise two full
 *  date+time labels -- a coalesced session almost never crosses midnight,
 *  but nothing here assumes it can't. */
function formatVersionAt(node: Extract<VersionTimelineNode, { kind: 'version' }>) {
  if (!node.rangeStart) return formatDateTime(node.at);
  const sameDay = node.rangeStart.slice(0, 10) === node.at.slice(0, 10);
  return sameDay
    ? `${formatTime(node.rangeStart)}–${formatTime(node.at)}`
    : `${formatDateTime(node.rangeStart)} – ${formatDateTime(node.at)}`;
}

export function PostVersionHistorySheet({
  postId,
  open,
  onOpenChange,
  statusEvents,
  approvals,
}: PostVersionHistorySheetProps) {
  const { data: versions = [], isLoading } = useQuery({
    queryKey: ['post-content-versions', String(postId)],
    queryFn: () => getPostContentVersions([postId]),
    enabled: open,
  });

  const nodes = useMemo(
    () => buildVersionTimeline(versions, statusEvents, approvals),
    [versions, statusEvents, approvals],
  );
  const versionNodes = useMemo(
    () =>
      nodes.filter(
        (n): n is Extract<VersionTimelineNode, { kind: 'version' }> => n.kind === 'version',
      ),
    [nodes],
  );

  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open || versionNodes.length === 0) return;
    if (!selectedKey || !versionNodes.some((n) => n.key === selectedKey)) {
      setSelectedKey(versionNodes[versionNodes.length - 1].key);
    }
  }, [open, versionNodes, selectedKey]);

  const selectedNode = versionNodes.find((n) => n.key === selectedKey) ?? null;
  const precedingVersion = selectedNode ? findPrecedingVersion(nodes, selectedNode) : null;

  const [resolvedCurrent, setResolvedCurrent] = useState<Record<string, unknown> | null>(null);
  const [resolvedPrevious, setResolvedPrevious] = useState<Record<string, unknown> | null>(null);
  // Remount key for ReadOnlyTipTap, set together with resolvedCurrent/
  // resolvedPrevious inside the effect below (never derived from selection
  // state directly). useEditor only builds its document once per mount, so
  // switching versions needs a fresh instance -- but keying off selection
  // state changes one render before the resolved content below catches up
  // (resolution is async, via a separate effect+state), so the remount
  // would land with the OLD content and then silently miss the real update
  // once it arrives, since the key wouldn't change again. Keying off this
  // instead guarantees the remount happens in the same commit as the
  // content it renders.
  const [resolvedKey, setResolvedKey] = useState('none');

  useEffect(() => {
    const current = selectedNode?.version.conteudo ?? null;
    const previous = precedingVersion?.conteudo ?? null;
    const nextKey = `${selectedNode?.version.id ?? 'none'}-${precedingVersion?.id ?? 'none'}`;

    if (!current && !previous) {
      setResolvedCurrent(current);
      setResolvedPrevious(previous);
      setResolvedKey(nextKey);
      return;
    }
    // Batch both docs' R2 keys into one call -- a naive per-doc resolve would
    // double the signed-URL round trips for every diff.
    const keys = Array.from(new Set([...extractR2Keys(current), ...extractR2Keys(previous)]));
    if (keys.length === 0) {
      setResolvedCurrent(current);
      setResolvedPrevious(previous);
      setResolvedKey(nextKey);
      return;
    }
    let cancelled = false;
    resolveInlineImageUrls(keys)
      .then((urlMap) => {
        if (cancelled) return;
        setResolvedCurrent(current ? injectSignedUrls(current, urlMap) : current);
        setResolvedPrevious(previous ? injectSignedUrls(previous, urlMap) : previous);
        setResolvedKey(nextKey);
      })
      .catch(() => {
        if (cancelled) return;
        setResolvedCurrent(current);
        setResolvedPrevious(previous);
        setResolvedKey(nextKey);
      });
    return () => {
      cancelled = true;
    };
    // A coalesced save can mutate the SAME version row (same id, new
    // last_touched_at) while the sheet stays mounted across a close/reopen
    // -- keying only on id would miss the update and leave stale content
    // resolved. last_touched_at is the reliable change proxy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedNode?.version.id,
    selectedNode?.version.last_touched_at,
    precedingVersion?.id,
    precedingVersion?.last_touched_at,
  ]);

  const showIgCaption = !!(selectedNode?.version.ig_caption || precedingVersion?.ig_caption);
  const showTiktokCaption = !!(
    selectedNode?.version.tiktok_caption || precedingVersion?.tiktok_caption
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-3xl"
        overlayClassName="z-[9010]"
      >
        <SheetHeader className="border-b px-5 py-4 text-left">
          <SheetTitle className="flex items-center gap-2 text-[15px]">
            <History className="h-4 w-4" /> Histórico de versões
          </SheetTitle>
        </SheetHeader>

        {isLoading ? (
          <div className="flex-1 px-5 py-6 text-[13px] text-muted-foreground">Carregando…</div>
        ) : versions.length === 0 ? (
          <div className="flex-1 px-5 py-6 text-[13px] text-muted-foreground">
            Sem histórico registrado ainda. Versões passam a ser guardadas a partir da próxima
            edição de conteúdo deste post.
          </div>
        ) : (
          <div className="flex flex-1 overflow-hidden">
            <div className="w-[288px] shrink-0 overflow-y-auto border-r">
              {nodes.map((node) =>
                node.kind === 'version' ? (
                  <button
                    key={node.key}
                    onClick={() => setSelectedKey(node.key)}
                    className={`block w-full border-b px-4 py-3 text-left transition-colors hover:bg-muted/50 ${
                      node.key === selectedKey ? 'bg-muted' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-medium">
                        {actorLabelFor(node.version.source, node.version.actor_name)}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {formatVersionAt(node)}
                      </span>
                    </div>
                    {node.version.suggestion_id != null && (
                      <span className="mt-1 inline-block text-[11px] text-muted-foreground">
                        via sugestão aceita
                      </span>
                    )}
                  </button>
                ) : (
                  <div key={node.key} className="border-b bg-muted/30 px-4 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px] font-medium text-muted-foreground">
                        {node.label}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {formatDateTime(node.at)}
                      </span>
                    </div>
                    <span className="text-[11px] text-muted-foreground">{node.actorLabel}</span>
                    {node.comment && (
                      <p className="mt-1 text-[12px] italic text-muted-foreground">
                        “{node.comment}”
                      </p>
                    )}
                  </div>
                ),
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {!selectedNode ? null : (
                <div className="space-y-4">
                  {!precedingVersion && (
                    <p className="text-[12px] font-medium text-muted-foreground">Versão inicial</p>
                  )}
                  {selectedNode.version.conteudo && resolvedCurrent && (
                    <ReadOnlyTipTap
                      key={resolvedKey}
                      content={
                        precedingVersion && resolvedPrevious
                          ? computeTipTapDiff(resolvedPrevious, resolvedCurrent)
                          : resolvedCurrent
                      }
                    />
                  )}
                  {showIgCaption && (
                    <div className="border-t pt-3">
                      <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
                        Legenda do Instagram
                      </p>
                      <DiffView
                        segments={computeWordDiff(
                          (precedingVersion
                            ? precedingVersion.ig_caption
                            : selectedNode.version.ig_caption) ?? '',
                          selectedNode.version.ig_caption ?? '',
                        )}
                      />
                    </div>
                  )}
                  {showTiktokCaption && (
                    <div className="border-t pt-3">
                      <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
                        Legenda do TikTok
                      </p>
                      <DiffView
                        segments={computeWordDiff(
                          (precedingVersion
                            ? precedingVersion.tiktok_caption
                            : selectedNode.version.tiktok_caption) ?? '',
                          selectedNode.version.tiktok_caption ?? '',
                        )}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="border-t px-5 py-2.5 text-[11px] text-muted-foreground">
          Somente leitura. Nenhuma versão pode ser restaurada por aqui.
        </div>
      </SheetContent>
    </Sheet>
  );
}
