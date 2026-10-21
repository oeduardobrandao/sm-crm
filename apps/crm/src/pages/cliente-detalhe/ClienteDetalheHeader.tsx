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
  /** `can('clientes', 'editar') === true`. Hides the "Editar" button (and,
   * since it's the only trigger, the ClienteEditDialog it opens) when false
   * -- a custom role with only `clientes:ver` reached this page but could
   * still edit the client via this header button before this gate. */
  canEdit: boolean;
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

/*
 * The header's pieces are exported so the desktop Vidro toolbar can compose the same
 * elements (ClienteDetalhePage): back + avatar lead, the name is the title, the badges
 * are the subtitle and "Editar" is the primary action.
 */

export function ClienteBackButton({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation('clients');
  return (
    <Button
      variant="outline"
      size="icon"
      className="cliente-detalhe-header__back"
      onClick={onBack}
      aria-label={t('detail.nav.backToClients')}
    >
      <ArrowLeft className="h-4 w-4" />
    </Button>
  );
}

export function ClienteAvatar(props: {
  clienteId: number;
  nome: string;
  initials: string;
  cor: string;
  imageUrl?: string | null;
  canEditPhoto: boolean;
}) {
  return (
    <ClienteAvatarUpload
      clienteId={props.clienteId}
      nome={props.nome}
      cor={props.cor}
      initials={props.initials}
      imageUrl={props.imageUrl ?? null}
      canEdit={props.canEditPhoto}
    />
  );
}

export function ClienteBadges({ plano, status }: { plano: string; status: string }) {
  const { t: tc } = useTranslation();
  return (
    <div className="cliente-detalhe-header__badges">
      {plano?.trim() && <span className="badge badge-neutral">{plano}</span>}
      <span className={`badge ${STATUS_CLASS[status] ?? 'badge-neutral'}`}>
        {tc(`status.${status}`, { defaultValue: status })}
      </span>
    </div>
  );
}

export function ClienteEditButton({ onEdit }: { onEdit: () => void }) {
  const { t: tc } = useTranslation();
  return (
    <Button variant="outline" className="cliente-detalhe-header__edit" onClick={onEdit}>
      <Edit2 className="h-4 w-4" /> {tc('actions.edit')}
    </Button>
  );
}

export function ClienteDetalheHeader(props: ClienteDetalheHeaderProps) {
  return (
    <header className="cliente-detalhe-header">
      <div className="cliente-detalhe-header__identity">
        <ClienteBackButton onBack={props.onBack} />
        <ClienteAvatar
          clienteId={props.clienteId}
          nome={props.nome}
          initials={props.initials}
          cor={props.cor}
          imageUrl={props.imageUrl}
          canEditPhoto={props.canEditPhoto}
        />
        <div className="cliente-detalhe-header__text">
          <h2 className="cliente-detalhe-header__name">{props.nome}</h2>
          <ClienteBadges plano={props.plano} status={props.status} />
        </div>
      </div>
      {props.canEdit && <ClienteEditButton onEdit={props.onEdit} />}
    </header>
  );
}
