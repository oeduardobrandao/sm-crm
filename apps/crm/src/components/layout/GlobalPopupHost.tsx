import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { PopupCard, defaultSecondaryLabel } from '@mesaas/ui/PopupCard';
import { Dialog, DialogOverlay, DialogPortal } from '@/components/ui/dialog';
import { useAuth } from '@/context/AuthContext';
import { useGuide } from '@/components/guide/GuideContext';
import { captureEvent } from '@/lib/analytics';
import { resolveInlineImageUrls } from '@/services/inlineImage';
import { openExternalUrl, sanitizeUrl } from '@/utils/security';
import type { GlobalPopup } from '@/store/popups';
import { usePopups } from '@/hooks/usePopups';
import { pickPopup } from '@/hooks/pickPopup';
import {
  markPopupClosed,
  markPopupShown,
  markPopupsSkipped,
  readPopupSession,
} from '@/hooks/popupSession';

interface Decision {
  popup: GlobalPopup;
  images: Record<string, string>;
}

/**
 * Popup global (spec 2026-09-04, Parte 3). Decide UMA vez por montagem, quando auth,
 * as duas queries e a decisão de auto-abertura do guia estão prontas. Não usa o
 * DialogContent do CRM: ele força padding e um X próprio que não desligam.
 */
export default function GlobalPopupHost({ openDelayMs = 800 }: { openDelayMs?: number }) {
  const { loading } = useAuth();
  const guide = useGuide();
  const navigate = useNavigate();
  const { popupsQuery, interactionsQuery, record } = usePopups();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const decided = useRef(false);
  const mounted = useRef(true);
  const titleId = useId();
  const bodyId = useId();

  const guideState = guide?.autoOpen ?? 'no';
  const ready =
    !loading &&
    popupsQuery.status !== 'pending' &&
    interactionsQuery.status !== 'pending' &&
    guideState !== 'unknown';

  // Snapshot dos valores no momento da decisão: o efeito depende só de `ready`,
  // para um refetch ou um re-render não cancelar o timer de abertura. Escrito
  // num efeito sem deps (roda a cada render, depois de renderizar) em vez de
  // durante o render, para não mutar um ref na fase de render.
  const snapshot = {
    guideState,
    guideOpen: guide?.isOpen ?? false,
    popups: popupsQuery.data,
    interactions: interactionsQuery.data,
    error: popupsQuery.status === 'error' || interactionsQuery.status === 'error',
  };
  const latest = useRef(snapshot);
  useEffect(() => {
    latest.current = snapshot;
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!ready || decided.current) return;
    decided.current = true;
    const snap = latest.current;

    if (snap.guideState === 'yes' || snap.guideOpen) {
      markPopupsSkipped();
      return;
    }
    if (snap.error) {
      console.warn('[popups] queries failed; no popup this session');
      return;
    }

    const interactions = snap.interactions ?? [];
    const chosen = pickPopup(snap.popups ?? [], interactions, readPopupSession());
    if (!chosen) return;

    (async () => {
      const keys = chosen.pages.map((p) => p.image_key).filter((k): k is string => Boolean(k));
      let images: Record<string, string> = {};
      if (keys.length > 0) {
        try {
          images = await resolveInlineImageUrls(keys);
        } catch (err) {
          console.warn('[popups] image signing failed; opening without images', err);
        }
      }
      await new Promise((r) => setTimeout(r, openDelayMs));
      if (!mounted.current) return;

      setDecision({ popup: chosen, images });
      setPage(0);
      setOpen(true);
      markPopupShown(chosen.id);
      const alreadySeen = interactions.some((i) => i.popup_id === chosen.id && i.action === 'seen');
      if (!alreadySeen) record(chosen.id, 'seen');
      captureEvent('popup_shown', { popup_id: chosen.id, pages: chosen.pages.length });
    })();
  }, [ready, openDelayMs, record]);

  const popup = decision?.popup ?? null;

  const handleClose = useCallback(() => {
    if (!popup) return;
    record(popup.id, 'closed');
    markPopupClosed(popup.id);
    captureEvent('popup_closed', { popup_id: popup.id, page });
    setOpen(false);
  }, [popup, page, record]);

  const handleAck = useCallback(() => {
    if (!popup) return;
    record(popup.id, 'ack');
    captureEvent('popup_ack', { popup_id: popup.id });
    setOpen(false);
  }, [popup, record]);

  const handleCta = useCallback(() => {
    if (!popup || !popup.cta_url) return;
    record(popup.id, 'cta');
    captureEvent('popup_cta', { popup_id: popup.id });
    setOpen(false);
    const safe = sanitizeUrl(popup.cta_url);
    if (safe.startsWith('/')) navigate(safe);
    else openExternalUrl(popup.cta_url); // null (no-op) quando a URL é rejeitada
  }, [popup, record, navigate]);

  const handlePageChange = useCallback(
    (next: number) => {
      if (!popup) return;
      setPage(next);
      captureEvent('popup_page', { popup_id: popup.id, page: next });
    },
    [popup],
  );

  if (!popup) return null;

  const hasCta = Boolean(popup.cta_label && popup.cta_url);
  const requireAck = popup.require_ack;
  const secondaryLabel = popup.secondary_label ?? defaultSecondaryLabel(requireAck, hasCta);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Esc e clique fora chegam aqui quando não são bloqueados por require_ack.
        if (!next && !requireAck) handleClose();
      }}
    >
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-1/2 z-[9011] w-[calc(100%-32px)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          onEscapeKeyDown={(e) => {
            if (requireAck) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (requireAck) e.preventDefault();
          }}
          aria-labelledby={titleId}
          aria-describedby={bodyId}
        >
          {/* asChild + span: o card já renderiza o h2 do título (apontado pelo
              aria-labelledby). Um Title <h2> aqui duplicaria o heading; este só
              existe para o aviso de a11y do Radix. aria-hidden para não ser
              anunciado de novo por leitores de tela (o h2 do card já é). */}
          <DialogPrimitive.Title asChild>
            <span className="sr-only" aria-hidden="true">
              {popup.pages[page]?.title}
            </span>
          </DialogPrimitive.Title>
          <PopupCard
            pages={popup.pages.map((p) => ({
              title: p.title,
              eyebrow: p.eyebrow,
              body: p.body,
              imageUrl: p.image_key ? (decision?.images[p.image_key] ?? null) : null,
            }))}
            page={page}
            onPageChange={handlePageChange}
            ctaLabel={hasCta ? popup.cta_label : null}
            ctaStyle={popup.cta_style}
            secondaryLabel={secondaryLabel}
            requireAck={requireAck}
            sanitizeHref={sanitizeUrl}
            onCta={hasCta ? handleCta : undefined}
            onSecondary={requireAck ? handleAck : handleClose}
            onClose={handleClose}
            titleId={titleId}
            bodyId={bodyId}
          />
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
