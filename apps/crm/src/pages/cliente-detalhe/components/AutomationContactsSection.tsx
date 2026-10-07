import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/context/AuthContext';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import {
  CONTACTS_KEY,
  CONTACT_COUNTS_KEY,
  getContactCounts,
  listInstagramContacts,
  type ContactFilters,
} from '@/store';
import { ContactsList } from '../../automacoes/contacts/ContactsList';
import { exportContactsCsv } from '../../automacoes/contacts/contactsCsv';
import { contactsHref } from '../../automacoes/contacts/useContactsFilters';

const PREVIEW = 10;

export function AutomationContactsSection({
  clienteId,
  clienteNome,
}: {
  clienteId: number;
  clienteNome: string;
}) {
  const { t } = useTranslation('automations');
  const { can } = useAuth();
  const allowed = can('automacoes', 'ver') === true;
  const isDesktop = useIsDesktop(901);

  const filters: ContactFilters = useMemo(
    () => ({
      clientId: clienteId,
      automationId: null,
      from: null,
      to: null,
      reachedOnly: true,
      search: '',
    }),
    [clienteId],
  );

  const countsQuery = useQuery({
    queryKey: CONTACT_COUNTS_KEY,
    queryFn: getContactCounts,
    enabled: allowed,
  });
  const hasContacts = (countsQuery.data ?? []).some(
    (c) => c.client_id === clienteId && c.total_count > 0,
  );

  const listQuery = useQuery({
    queryKey: [CONTACTS_KEY, filters, 1, PREVIEW],
    queryFn: () => listInstagramContacts(filters, 1, PREVIEW),
    enabled: allowed && hasContacts,
  });

  const [exporting, setExporting] = useState(false);
  const clientesById = useMemo(() => new Map([[clienteId, clienteNome]]), [clienteId, clienteNome]);

  if (!allowed || !hasContacts) return null;

  const onExport = async () => {
    setExporting(true);
    try {
      const n = await exportContactsCsv(filters, clientesById, clienteNome);
      toast.success(t('contacts.exportDone', { count: n }));
    } catch {
      toast.error(t('contacts.exportError'));
    } finally {
      setExporting(false);
    }
  };

  const rows = listQuery.data?.rows ?? [];

  return (
    <section style={{ marginTop: '1.5rem' }}>
      <div className="flex items-center justify-between gap-2" style={{ marginBottom: '0.75rem' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>
          {t('contacts.sectionTitle')}
        </h3>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onExport}
            disabled={exporting || rows.length === 0}
          >
            {exporting ? (
              <Spinner size="sm" />
            ) : (
              <Download className="h-4 w-4" style={{ marginRight: '0.4rem' }} />
            )}
            {t('contacts.export')}
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link to={contactsHref({ clientId: clienteId })}>{t('contacts.viewAll')}</Link>
          </Button>
        </div>
      </div>
      {listQuery.isLoading ? (
        <div className="flex justify-center p-4">
          <Spinner size="sm" />
        </div>
      ) : rows.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          {t('contacts.emptyNoneReached')}
        </p>
      ) : (
        <ContactsList
          rows={rows}
          clientesById={clientesById}
          showClient={false}
          isDesktop={isDesktop}
        />
      )}
    </section>
  );
}
