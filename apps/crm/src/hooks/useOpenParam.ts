import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Deep link de abertura de dialog via query param (?param=1).
 *
 * Reativo ao PARÂMETRO, não ao mount: navegar para a mesma rota trocando só a
 * query não remonta a página (spec do guia, revisão externa P1). Remove só o
 * próprio param, preservando o resto da query, com replace (sem entrada de
 * histórico).
 */
export function useOpenParam(param: string, onOpen: () => void): void {
  const [searchParams, setSearchParams] = useSearchParams();
  const present = searchParams.get(param) === '1';
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const setSearchParamsRef = useRef(setSearchParams);
  setSearchParamsRef.current = setSearchParams;

  useEffect(() => {
    if (!present) return;
    onOpenRef.current();
    setSearchParamsRef.current(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(param);
        return next;
      },
      { replace: true },
    );
  }, [present, param]);
}
