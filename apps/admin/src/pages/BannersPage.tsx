import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  listBanners,
  createBanner,
  updateBanner,
  deleteBanner,
  listPlans,
  listWorkspaces,
  type GlobalBanner,
} from '../lib/api';
import { AdminFormSheet } from '../components/shell/AdminFormSheet';
import { useIsPhone } from '../hooks/useIsPhone';
import { BannerFormFields } from './banners/BannerFormFields';
import { BannersDesktop } from './banners/BannersDesktop';
import { BannersPhone } from './banners/BannersPhone';
import { EMPTY_FORM, bannerToForm, formToPayload, type FormState } from './banners/banner-form';

const FORM_ID = 'banner-form';

export default function BannersPage() {
  const queryClient = useQueryClient();
  const isPhone = useIsPhone();
  const [editingBanner, setEditingBanner] = useState<GlobalBanner | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM });
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'banners', statusFilter],
    queryFn: () => listBanners(statusFilter ? { status: statusFilter } : undefined),
  });

  const { data: plansData } = useQuery({
    queryKey: ['admin', 'plans'],
    queryFn: listPlans,
  });

  const { data: workspacesData } = useQuery({
    queryKey: ['admin', 'workspaces-all'],
    queryFn: () => listWorkspaces({ limit: 500 }),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin', 'banners'] });

  const createMut = useMutation({
    mutationFn: () => createBanner(formToPayload(form)),
    onSuccess: () => {
      invalidate();
      toast.success('Banner criado');
      closeForm();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMut = useMutation({
    mutationFn: () => updateBanner({ banner_id: editingBanner!.id, ...formToPayload(form) }),
    onSuccess: () => {
      invalidate();
      toast.success('Banner atualizado');
      closeForm();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteBanner(id),
    onSuccess: () => {
      invalidate();
      toast.success('Banner excluído');
      closeForm();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const openCreate = () => {
    setEditingBanner(null);
    setForm({ ...EMPTY_FORM });
    setShowForm(true);
  };

  const openEdit = (b: GlobalBanner) => {
    setEditingBanner(b);
    setForm(bannerToForm(b));
    setShowForm(true);
  };

  // editingBanner stays until the next open so the sheet's title does not flip while it animates out.
  const closeForm = () => setShowForm(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingBanner) updateMut.mutate();
    else createMut.mutate();
  };

  // Both delete paths (row menu and the form's button) ask first.
  const confirmDelete = (b: GlobalBanner) => {
    if (window.confirm('Excluir este banner?')) deleteMut.mutate(b.id);
  };

  const banners = (data?.banners || []).filter(
    (b) => !search || b.content.toLowerCase().includes(search.toLowerCase()),
  );

  const view = {
    banners,
    plans: plansData?.plans,
    isLoading,
    statusFilter,
    onStatusFilterChange: setStatusFilter,
    search,
    onSearchChange: setSearch,
    onCreate: openCreate,
    onEdit: openEdit,
    onDelete: confirmDelete,
  };

  return (
    <>
      {isPhone ? <BannersPhone {...view} /> : <BannersDesktop {...view} />}

      <AdminFormSheet
        open={showForm}
        onOpenChange={(open) => {
          if (!open) closeForm();
        }}
        title={editingBanner ? 'Editar banner' : 'Novo banner'}
        formId={FORM_ID}
        submitLabel={editingBanner ? 'Atualizar' : 'Criar'}
        submitting={createMut.isPending || updateMut.isPending}
        width="md"
      >
        <form id={FORM_ID} onSubmit={handleSubmit}>
          <BannerFormFields
            form={form}
            setForm={setForm}
            plans={plansData?.plans}
            workspaces={workspacesData?.workspaces}
            onDelete={
              editingBanner && editingBanner.status === 'draft'
                ? () => confirmDelete(editingBanner)
                : undefined
            }
            deleting={deleteMut.isPending}
          />
        </form>
      </AdminFormSheet>
    </>
  );
}
