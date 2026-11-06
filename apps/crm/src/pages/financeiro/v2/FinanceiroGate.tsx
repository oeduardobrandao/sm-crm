import { lazy } from 'react';
import { Navigate, useMatch } from 'react-router-dom';
import { useFinanceiroV2 } from '@/hooks/useFinanceiroV2';
import FinanceiroV2Layout from './FinanceiroV2Layout';

const FinanceiroPage = lazy(() => import('../FinanceiroPage'));

/**
 * Element of the `/financeiro` route. Flag off: the legacy ledger at `/financeiro` and no
 * other path (every child bounces back). Flag on: the v2 layout, with `/financeiro` itself
 * redirecting to Rentabilidade. It owns the index behaviour in both modes, so the route has
 * no index child.
 */
export default function FinanceiroGate() {
  const { ativo, isLoading } = useFinanceiroV2();
  const isIndex = useMatch({ path: '/financeiro', end: true }) !== null;

  // AppLayout's own guard already shows the loading state.
  if (isLoading) return null;
  if (!ativo) return isIndex ? <FinanceiroPage /> : <Navigate to="/financeiro" replace />;
  if (isIndex) return <Navigate to="/financeiro/rentabilidade" replace />;
  return <FinanceiroV2Layout />;
}
