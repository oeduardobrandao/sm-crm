import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Button } from '@/components/ui/button';

export function UpgradeLockedScreen({ featureLabel }: { featureLabel: string }) {
  const navigate = useNavigate();
  const { role } = useAuth();
  const isOwner = role === 'owner';
  return (
    <div className="flex flex-col items-center justify-center h-[60vh] text-center gap-3 p-8">
      <h1 className="text-xl font-bold">{featureLabel} não está no seu plano</h1>
      {isOwner ? (
        <>
          <p className="text-muted">Faça upgrade para desbloquear este recurso.</p>
          <Button onClick={() => navigate('/configuracao/cobranca')}>Fazer upgrade</Button>
        </>
      ) : (
        <p className="text-muted">
          Fale com o dono do workspace para liberar este recurso.
        </p>
      )}
    </div>
  );
}
