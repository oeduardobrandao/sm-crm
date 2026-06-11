import { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEntitlements } from '../../hooks/useEntitlements';

/** Renders children only if the feature is enabled; otherwise an inline upgrade nudge. */
export function FeatureGate({
  flag,
  label,
  children,
}: {
  flag: string;
  label?: string;
  children: ReactNode;
}) {
  const { hasFeature, isLoading } = useEntitlements();
  const navigate = useNavigate();
  if (isLoading || hasFeature(flag)) return <>{children}</>;
  return (
    <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
      <p>{label ?? 'Este recurso'} não está disponível no seu plano.</p>
      <button
        className="mt-2 underline text-primary"
        onClick={() => navigate('/configuracao/cobranca')}
      >
        Fazer upgrade
      </button>
    </div>
  );
}
