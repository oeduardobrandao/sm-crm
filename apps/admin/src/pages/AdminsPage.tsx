import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { listAdmins, inviteAdmin, removeAdmin } from '../lib/api';
import { useAdminAuth } from '../context/AdminAuthContext';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Skeleton } from '../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';

export default function AdminsPage() {
  const queryClient = useQueryClient();
  const { user } = useAdminAuth();
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

  const admins = data?.admins ?? [];
  const formatDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

  return (
    <div>
      <PageHeader title="Admins" description="Administradores da plataforma" />

      <form onSubmit={handleInvite} className="mb-8 flex flex-col gap-3 sm:flex-row">
        <Input
          type="email"
          aria-label="E-mail do novo admin"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="E-mail do novo admin…"
          required
          className="flex-1"
        />
        <Button type="submit" disabled={inviteMutation.isPending}>
          <UserPlus />
          Convidar admin
        </Button>
      </form>

      <Card>
        {isLoading ? (
          <div className="flex flex-col gap-3 p-5">
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-4 w-60" />
          </div>
        ) : isError ? (
          <ErrorState message="Não foi possível carregar os admins." onRetry={() => refetch()} />
        ) : admins.length === 0 ? (
          <EmptyState icon={Users} title="Nenhum admin cadastrado" />
        ) : (
          <>
            <Table className="hidden md:table">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[0.7rem] uppercase tracking-wider">E-mail</TableHead>
                  <TableHead className="text-[0.7rem] uppercase tracking-wider">
                    Convidado por
                  </TableHead>
                  <TableHead className="text-[0.7rem] uppercase tracking-wider">
                    Adicionado em
                  </TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {admins.map((admin) => {
                  const isSelf = admin.user_id === user?.id;
                  return (
                    <TableRow key={admin.id}>
                      <TableCell className="text-sm text-foreground">{admin.email}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {admin.invited_by_email || '—'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(admin.created_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        {!isSelf && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Remover admin"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => removeMutation.mutate(admin.id)}
                            disabled={removeMutation.isPending}
                          >
                            <Trash2 size={14} />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            <ul className="flex flex-col md:hidden">
              {admins.map((admin) => {
                const isSelf = admin.user_id === user?.id;
                return (
                  <li
                    key={admin.id}
                    className="flex items-center justify-between gap-3 border-b border-border/50 px-5 py-3 last:border-0"
                  >
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-sm text-foreground">{admin.email}</span>
                      <span className="text-xs text-muted-foreground">
                        {admin.invited_by_email ? `Por ${admin.invited_by_email}` : '—'} ·{' '}
                        {formatDate(admin.created_at)}
                      </span>
                    </div>
                    {!isSelf && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Remover admin"
                        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => removeMutation.mutate(admin.id)}
                        disabled={removeMutation.isPending}
                      >
                        <Trash2 size={14} />
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
