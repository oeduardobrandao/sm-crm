// Autosave do editor de blocos, no padrão inline da casa (WorkflowDrawer:448):
// otimista no estado, saving liga ANTES do debounce, clearTimeout do anterior,
// validateLayout como gate final antes do PostgREST.
// Em falha: retém o payload, re-tenta com backoff (5s, 15s, 30s). Esgotado o
// cap, para de tentar (payload continua retido, sem novo timer) até que uma
// edição nova ou o unmount reabram o ciclo. Nova edição zera o contador.
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { validateLayout, type ReportLayout } from '@mesaas/report-blocks/types';
import { updateReportDoc } from '../../services/reportDocs';

const LAYOUT_DEBOUNCE_MS = 1500;
const TITLE_DEBOUNCE_MS = 400;
const RETRY_DELAYS_MS = [5000, 15000, 30000];
const SAVE_ERROR_MSG = 'Erro ao salvar o relatório';
// Mesmo id em toda falha de autosave: sonner substitui o toast existente em
// vez de empilhar um novo a cada retry (uma falha persistente não deve virar
// uma pilha de toasts idênticos na tela).
const SAVE_ERROR_TOAST = { id: 'report-autosave-error' };

// Cadeia de save POR DOCUMENTO, viva no módulo e não na instância do hook:
// a fila de uma instância desmontada e a da montagem seguinte do mesmo doc
// precisam ser a MESMA, senão o flush de unmount corre com os saves da
// remontagem e um request antigo pode sobrescrever edição mais nova.
const docSaveChains = new Map<string, Promise<void>>();

function appendToDocChain(docId: string, task: () => Promise<void>): void {
  const prev = docSaveChains.get(docId) ?? Promise.resolve();
  const next = prev
    .then(task)
    .catch((err) => {
      // Defesa: um elo rejeitado quebraria a cadeia pra sempre — todo save
      // futuro ficaria pendurado num .then() de uma promise já rejeitada.
      console.error('[relatorio-editor] elo da cadeia de save falhou:', err);
    })
    .then(() => {
      if (docSaveChains.get(docId) === next) docSaveChains.delete(docId);
    });
  docSaveChains.set(docId, next);
}

export function useLayoutAutosave(docId: string, initial: { layout: ReportLayout; title: string }) {
  const qc = useQueryClient();
  const [layout, setLayout] = useState<ReportLayout>(initial.layout);
  const [title, setTitleState] = useState(initial.title);
  const [saving, setSaving] = useState(false);

  const layoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleDirty = useRef(false);
  const pendingLayout = useRef<ReportLayout | null>(null);
  const docIdRef = useRef(docId);
  const titleRef = useRef(title);
  // Índice em RETRY_DELAYS_MS: quantas tentativas já falharam desde a última
  // edição (ou o último sucesso). Zera em applyLayout/setTitle (edição nova) e
  // em todo save bem-sucedido.
  const retryCount = useRef(0);
  const titleRetryCount = useRef(0);
  // Espelha `saving` de forma síncrona: o guard de beforeunload lê pela ref
  // (não pode depender de fechamento de render) pra saber, no exato instante
  // do evento, se um request está em voo.
  const savingRef = useRef(false);

  docIdRef.current = docId;
  titleRef.current = title;

  function setSavingState(value: boolean) {
    savingRef.current = value;
    setSaving(value);
  }

  useEffect(
    () => () => {
      if (layoutTimer.current) clearTimeout(layoutTimer.current);
      if (titleTimer.current) clearTimeout(titleTimer.current);
      // Best-effort: edição pendente não morre com a navegação; falha aqui é
      // aceita (sem retry pós-unmount) — o gate de validade se mantém.
      // O cache é atualizado ANTES do request: uma remontagem imediata do
      // mesmo doc lê a query (staleTime: Infinity) e precisa ver a edição em
      // voo, senão o editor renasce PRÉ-edição e o próximo save a perde. Se o
      // request falhar, o próximo save carrega o layout completo e cura.
      const pending = pendingLayout.current;
      if (pending) {
        const check = validateLayout(pending);
        if (check.ok) {
          const id = docIdRef.current;
          qc.setQueryData(['report-doc', id], (old: unknown) =>
            old ? { ...(old as object), layout: pending } : old,
          );
          appendToDocChain(id, async () => {
            try {
              await updateReportDoc(id, { layout: pending });
            } catch (err) {
              console.error('[relatorio-editor] flush de unmount falhou:', err);
            }
          });
        }
      }
      if (titleDirty.current) {
        const id = docIdRef.current;
        const titleToSave = titleRef.current;
        qc.setQueryData(['report-doc', id], (old: unknown) =>
          old ? { ...(old as object), title: titleToSave } : old,
        );
        appendToDocChain(id, async () => {
          try {
            await updateReportDoc(id, { title: titleToSave });
          } catch (err) {
            console.error('[relatorio-editor] flush de unmount falhou:', err);
          }
        });
      }
    },
    // qc: useQueryClient() é estável entre re-renders (mesmo QueryClient do
    // provider) — inclui-lo aqui satisfaz o exhaustive-deps sem mudar o
    // comportamento de "só no unmount".
    [qc],
  );

  function scheduleLayoutFlush(delayMs: number) {
    if (layoutTimer.current) clearTimeout(layoutTimer.current);
    layoutTimer.current = setTimeout(() => {
      layoutTimer.current = null;
      appendToDocChain(docIdRef.current, async () => {
        const toSave = pendingLayout.current;
        pendingLayout.current = null;
        if (!toSave) {
          if (pendingLayout.current === null) setSavingState(false);
          return;
        }
        const check = validateLayout(toSave);
        if (!check.ok) {
          // Bug de layoutOps se chegar aqui: nada de request com payload inválido.
          console.error('[relatorio-editor] layout inválido no autosave:', check);
          toast.error(SAVE_ERROR_MSG, SAVE_ERROR_TOAST);
          if (pendingLayout.current === null) setSavingState(false);
          return;
        }
        try {
          await updateReportDoc(docIdRef.current, { layout: toSave });
          // Cache canônico pós-save: sem isso, uma reentrada na SPA dentro do
          // gcTime serve o doc PRÉ-edição e o próximo save clobbera o que
          // acabou de ser persistido (achado C1).
          qc.setQueryData(['report-doc', docIdRef.current], (old: unknown) =>
            old ? { ...(old as object), layout: toSave } : old,
          );
          retryCount.current = 0;
        } catch (err) {
          console.error('[relatorio-editor] autosave falhou:', err);
          toast.error(SAVE_ERROR_MSG, SAVE_ERROR_TOAST);
          // Retém o payload: navegação ainda flusha no unmount. Se ainda houver
          // delay no backoff, agenda o próximo retry; esgotado, retém SEM
          // agendar (para de bombardear o backend até uma edição nova ou o
          // unmount). Edição mais nova que já chegou durante o request tem
          // prioridade sobre os dois casos (não mexe no pendingLayout dela).
          const delay = RETRY_DELAYS_MS[retryCount.current];
          if (delay !== undefined && pendingLayout.current === null) {
            retryCount.current += 1;
            pendingLayout.current = toSave;
            scheduleLayoutFlush(delay);
          } else if (pendingLayout.current === null) {
            pendingLayout.current = toSave;
          }
        } finally {
          if (pendingLayout.current === null) setSavingState(false);
        }
      });
    }, delayMs);
  }

  function scheduleTitleFlush(delayMs: number) {
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => {
      titleTimer.current = null;
      appendToDocChain(docIdRef.current, async () => {
        if (!titleDirty.current) return;
        titleDirty.current = false;
        const toSave = titleRef.current;
        try {
          await updateReportDoc(docIdRef.current, { title: toSave });
          // Cache canônico pós-save — mesmo racional do layout (achado C1).
          qc.setQueryData(['report-doc', docIdRef.current], (old: unknown) =>
            old ? { ...(old as object), title: toSave } : old,
          );
          titleRetryCount.current = 0;
        } catch (err) {
          console.error('[relatorio-editor] save de título falhou:', err);
          toast.error(SAVE_ERROR_MSG, SAVE_ERROR_TOAST);
          // Mesmo tratamento do layout: retenta com backoff até esgotar
          // RETRY_DELAYS_MS, depois retém a dirty flag sem novo timer.
          titleDirty.current = true;
          const delay = RETRY_DELAYS_MS[titleRetryCount.current];
          if (delay !== undefined) {
            titleRetryCount.current += 1;
            scheduleTitleFlush(delay);
          }
        }
      });
    }, delayMs);
  }

  function applyLayout(next: ReportLayout) {
    if (next === layout) return;
    setLayout(next);
    pendingLayout.current = next;
    retryCount.current = 0;
    setSavingState(true);
    scheduleLayoutFlush(LAYOUT_DEBOUNCE_MS);
  }

  function setTitle(next: string) {
    setTitleState(next);
    titleDirty.current = true;
    titleRetryCount.current = 0;
    scheduleTitleFlush(TITLE_DEBOUNCE_MS);
  }

  // Guarda contra fechar/navegar para fora com edição não persistida: registra
  // uma vez (refs são estáveis, sem dependência de closure) e lê o estado mais
  // recente via ref no momento do evento, não do render em que foi montado.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (pendingLayout.current !== null || titleDirty.current || savingRef.current) {
        e.preventDefault();
        // Exigido por navegadores legados para mostrar o prompt nativo.
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  return { layout, applyLayout, title, setTitle, saving };
}
