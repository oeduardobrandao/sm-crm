import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Link2, XCircle } from 'lucide-react';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import { PhoneConfirmSheet } from '@/components/mobile/PhoneConfirmSheet';
import { ConnectLinkDialog } from '@/components/instagram/ConnectLinkDialog';
import {
  createConnectLink,
  getConnectLink,
  revokeConnectLink,
  type ConnectLink,
} from '@/services/connectLink';

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('pt-BR');
  } catch {
    return iso;
  }
}

/**
 * `ConnectLinkRow` on phones: the same link (query key, generate, revoke, the share
 * dialog) as grouped rows. Revoking asks in a confirm sheet stacked over whatever is
 * open (the row or the share dialog) instead of `window.confirm`.
 */
export function ConnectLinkCells({
  clienteId,
  clienteEmail,
}: {
  clienteId: number;
  clienteEmail: string | null;
}) {
  const { t } = useTranslation('clients');
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

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

  return (
    <>
      <GroupedList header={t('connect.dialogTitle')} headerAs="h3" className="phone-cli-wrap">
        {link ? (
          <>
            <Cell
              label={t('connect.dialogTitle')}
              subtitle={t('connect.activeUntil', { date: formatDate(link.expires_at) })}
              icon={<Link2 />}
              iconColor="var(--phone-fill)"
              onClick={() => setOpen(true)}
            />
            <Cell
              label={t('connect.revoke')}
              icon={<XCircle />}
              destructive
              disabled={revoke.isPending}
              onClick={() => setConfirmRevoke(true)}
            />
          </>
        ) : (
          <Cell
            label={t('connect.generate')}
            icon={<Link2 />}
            iconColor="var(--phone-fill)"
            disabled={generate.isPending}
            onClick={() => generate.mutate()}
          />
        )}
      </GroupedList>

      {link && (
        <ConnectLinkDialog
          clienteId={clienteId}
          clienteEmail={clienteEmail}
          link={link}
          open={open}
          onOpenChange={setOpen}
          onRevoke={() => setConfirmRevoke(true)}
        />
      )}
      <PhoneConfirmSheet
        open={confirmRevoke}
        title={t('connect.revoke')}
        message={t('connect.revokeConfirm')}
        actions={[
          {
            label: t('connect.revoke'),
            destructive: true,
            onSelect: () => {
              setConfirmRevoke(false);
              revoke.mutate();
            },
          },
        ]}
        onCancel={() => setConfirmRevoke(false)}
      />
    </>
  );
}
