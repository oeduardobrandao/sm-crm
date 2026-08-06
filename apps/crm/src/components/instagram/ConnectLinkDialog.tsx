import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Copy, Link2, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  createConnectLink,
  emailConnectLink,
  getConnectLink,
  revokeConnectLink,
  type ConnectLink,
} from '../../services/connectLink';

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('pt-BR');
  } catch {
    return iso;
  }
}

/**
 * Linha compacta na seção de Instagram da página do cliente.
 *
 * Um link reutilizável de 30 dias é uma credencial de vida longa que pode ficar
 * parada num grupo de WhatsApp. A mitigação é justamente esta linha: o link
 * pendente fica VISÍVEL, com a validade e o botão de revogar ao lado, sem que
 * ninguém precise abrir um diálogo para lembrar que ele existe.
 */
export function ConnectLinkRow({
  clienteId,
  clienteEmail,
}: {
  clienteId: number;
  clienteEmail: string | null;
}) {
  const { t } = useTranslation('clients');
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: link } = useQuery({
    queryKey: ['connect-link', clienteId],
    queryFn: () => getConnectLink(clienteId),
  });

  const generate = useMutation({
    mutationFn: () => createConnectLink(clienteId),
    onSuccess: (created: ConnectLink) => {
      qc.setQueryData(['connect-link', clienteId], created);
      setOpen(true);
    },
    onError: () => toast.error(t('connect.generateError')),
  });

  const revoke = useMutation({
    mutationFn: () => revokeConnectLink(clienteId),
    onSuccess: () => {
      qc.setQueryData(['connect-link', clienteId], null);
      setOpen(false);
      toast.success(t('connect.revoked'));
    },
  });

  const handleRevoke = () => {
    if (!window.confirm(t('connect.revokeConfirm'))) return;
    revoke.mutate();
  };

  return (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {link ? (
          <>
            <span className="text-sm text-muted-foreground">
              {t('connect.activeUntil', { date: formatDate(link.expires_at) })}
            </span>
            <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
              <Link2 className="mr-1.5 h-4 w-4" />
              {t('connect.dialogTitle')}
            </Button>
            <Button variant="ghost" size="sm" onClick={handleRevoke} disabled={revoke.isPending}>
              {t('connect.revoke')}
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => generate.mutate()}
            disabled={generate.isPending}
          >
            <Link2 className="mr-1.5 h-4 w-4" />
            {t('connect.generate')}
          </Button>
        )}
      </div>

      {link && (
        <ConnectLinkDialog
          clienteId={clienteId}
          clienteEmail={clienteEmail}
          link={link}
          open={open}
          onOpenChange={setOpen}
          onRevoke={handleRevoke}
        />
      )}
    </>
  );
}

export function ConnectLinkDialog({
  clienteId,
  clienteEmail,
  link,
  open,
  onOpenChange,
  onRevoke,
}: {
  clienteId: number;
  clienteEmail: string | null;
  link: ConnectLink;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRevoke: () => void;
}) {
  const { t } = useTranslation('clients');
  const [email, setEmail] = useState(clienteEmail ?? '');

  const send = useMutation({
    mutationFn: () => emailConnectLink(clienteId, email.trim()),
    onSuccess: () => toast.success(t('connect.sent')),
    onError: () => toast.error(t('connect.sendError')),
  });

  const copy = async () => {
    await navigator.clipboard.writeText(link.url);
    toast.success(t('connect.copied'));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('connect.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('connect.dialogIntro')}</DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Input readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} />
          <Button variant="outline" onClick={copy}>
            <Copy className="mr-1.5 h-4 w-4" />
            {t('connect.copy')}
          </Button>
        </div>

        <div className="mt-2">
          <label className="mb-1.5 block text-sm font-medium">{t('connect.emailLabel')}</label>
          <div className="flex gap-2">
            <Input
              type="email"
              value={email}
              placeholder={t('connect.emailPlaceholder')}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Button onClick={() => send.mutate()} disabled={send.isPending || !email.trim()}>
              <Mail className="mr-1.5 h-4 w-4" />
              {t('connect.send')}
            </Button>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {t('connect.activeUntil', { date: formatDate(link.expires_at) })}
          </span>
          <Button variant="ghost" size="sm" onClick={onRevoke}>
            {t('connect.revoke')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
