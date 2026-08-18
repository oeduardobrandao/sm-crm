import { ArrowLeft, Edit2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ClienteAvatarUpload } from './ClienteAvatarUpload';

interface ClienteDetalheHeaderProps {
  clienteId: number;
  nome: string;
  initials: string;
  cor: string;
  plano: string;
  status: string;
  imageUrl?: string | null;
  canEditPhoto: boolean;
  onBack: () => void;
  onEdit: () => void;
}

const STATUS_CLASS: Record<string, string> = {
  ativo: 'badge-success',
  pausado: 'badge-warning',
  encerrado: 'badge-danger',
  vigente: 'badge-success',
  a_assinar: 'badge-warning',
  pago: 'badge-success',
  agendado: 'badge-neutral',
};

export function ClienteDetalheHeader(props: ClienteDetalheHeaderProps) {
  const { t } = useTranslation('clients');
  const { t: tc } = useTranslation();

  return (
    <header className="cliente-detalhe-header">
      <div className="cliente-detalhe-header__identity">
        <Button
          variant="outline"
          size="icon"
          className="cliente-detalhe-header__back"
          onClick={props.onBack}
          aria-label={t('detail.nav.backToClients')}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <ClienteAvatarUpload
          clienteId={props.clienteId}
          nome={props.nome}
          cor={props.cor}
          initials={props.initials}
          imageUrl={props.imageUrl ?? null}
          canEdit={props.canEditPhoto}
        />
        <div className="cliente-detalhe-header__text">
          <h2 className="cliente-detalhe-header__name">{props.nome}</h2>
          <div className="cliente-detalhe-header__badges">
            <span className="badge badge-neutral">{props.plano}</span>
            <span className={`badge ${STATUS_CLASS[props.status] ?? 'badge-neutral'}`}>
              {tc(`status.${props.status}`, { defaultValue: props.status })}
            </span>
          </div>
        </div>
      </div>
      <Button variant="outline" className="cliente-detalhe-header__edit" onClick={props.onEdit}>
        <Edit2 className="h-4 w-4" /> {tc('actions.edit')}
      </Button>
    </header>
  );
}
