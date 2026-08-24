// apps/hub/src/pages/RelatorioPrintPage.tsx
// Fonte do PDF (spec §9): mesma render do viewer, sem chrome do portal, com o
// contrato de prontidão que o Gotenberg espera via waitForExpression. Auth
// própria por print token HMAC (?pt=); NUNCA token de portal.
import { useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { focusManager, useQuery } from '@tanstack/react-query';
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

  // Esta página roda em contextos SEM foco: o Chromium headless do Gotenberg e
  // abas em background reportam document.visibilityState === 'hidden'. O
  // retryer do TanStack v5 exige focusManager.isFocused() para CONTINUAR entre
  // tentativas — com retry: 1, uma primeira falha deixava a query pausada
  // ('pending'/'paused') para sempre e a página em branco, em vez de terminar
  // no grid ou no erro. Foco é uma otimização de UX interativa, sem sentido
  // num alvo de print: enquanto esta página está montada, declaramos o
  // contexto como focado. O cleanup volta ao padrão (derivar da visibilidade).
  useEffect(() => {
    focusManager.setFocused(true);
    return () => focusManager.setFocused(undefined);
  }, []);

  const { data, isError } = useQuery({
    queryKey: ['print-report-doc', docId],
    queryFn: () => fetchPrintReportDoc(docId ?? '', pt),
    enabled: !!docId && !!pt,
    retry: 1,
    // networkMode 'online' pausaria o PRIMEIRO fetch se o Chromium headless
    // reportar navigator.onLine === false (acontece em containers sem
    // interface enumerável). O print sempre tenta e sempre termina.
    networkMode: 'always',
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
