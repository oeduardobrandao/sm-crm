import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { listAdmins, inviteAdmin, removeAdmin } from '../lib/api';
import { useAdminAuth } from '../context/AdminAuthContext';
import { useIsPhone } from '../hooks/useIsPhone';
import { AdminsDesktop } from './admins/AdminsDesktop';
import { AdminsPhone } from './admins/AdminsPhone';

export default function AdminsPage() {
  const queryClient = useQueryClient();
  const { user } = useAdminAuth();
  const isPhone = useIsPhone();
  const [email, setEmail] = useState('');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'admins'],
    queryFn: listAdmins,
  });

  const inviteMutation = useMutation({
    mutationFn: () => inviteAdmin(email),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'admins'] });
      toast.success('Admin adicionado');
      setEmail('');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const removeMutation = useMutation({
    mutationFn: (adminId: string) => removeAdmin(adminId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'admins'] });
      toast.success('Admin removido');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    inviteMutation.mutate();
  };

  const view = {
    admins: data?.admins ?? [],
    isLoading,
    isError,
    onRetry: () => refetch(),
    currentUserId: user?.id,
    email,
    onEmailChange: setEmail,
    onInvite: handleInvite,
    inviting: inviteMutation.isPending,
    onRemove: (adminId: string) => removeMutation.mutate(adminId),
    removing: removeMutation.isPending,
  };

  return isPhone ? <AdminsPhone {...view} /> : <AdminsDesktop {...view} />;
}
