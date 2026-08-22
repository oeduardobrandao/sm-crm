// apps/hub/src/pages/RelatorioPrintPage.tsx
// Fonte do PDF (spec §9): mesma render do viewer, sem chrome do portal, com o
// contrato de prontidão que o Gotenberg espera via waitForExpression. Auth
// própria por print token HMAC (?pt=); NUNCA token de portal.
import { useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BlockRenderer } from '@mesaas/report-blocks/BlockRenderer';
import type { ReportDocSnapshot, ReportLayout } from '@mesaas/report-blocks/types';
import '@mesaas/report-blocks/styles.css';
import { fetchPrintReportDoc } from '../api';

declare global {
  interface Window {
    __REPORT_READY?: boolean;
  }
}

export function RelatorioPrintPage() {
  const { docId } = useParams<{ docId: string }>();
  const [params] = useSearchParams();
  const pt = params.get('pt') ?? '';

  const { data, isError } = useQuery({
    queryKey: ['print-report-doc', docId],
    queryFn: () => fetchPrintReportDoc(docId ?? '', pt),
    enabled: !!docId && !!pt,
    retry: 1,
  });

  const doc = data?.doc;
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    (async () => {
      // Fontes e imagens resolvidas ANTES de declarar prontidão: sem isso o
      // chromium imprime placeholders. Optional chaining: jsdom não tem
      // document.fonts nem img.decode.
      await document.fonts?.ready;
      const imgs = Array.from(document.images);
      await Promise.allSettled(imgs.map((img) => img.decode?.() ?? Promise.resolve()));
      if (!cancelled) window.__REPORT_READY = true;
    })();
    return () => {
      cancelled = true;
    };
  }, [doc]);

  if (isError) {
    return (
      <p style={{ fontFamily: 'sans-serif', padding: '2rem' }}>
        Não foi possível carregar o relatório.
      </p>
    );
  }
  if (!doc || doc.data_snapshot == null) return null;
  return (
    <div style={{ background: '#ffffff', padding: '0' }}>
      <BlockRenderer
        layout={doc.layout as ReportLayout}
        snapshot={doc.data_snapshot as ReportDocSnapshot}
        mode="print"
      />
    </div>
  );
}
