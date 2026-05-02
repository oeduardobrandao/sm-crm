import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { listAdmins, inviteAdmin, removeAdmin } from '../lib/api';
import { useAdminAuth } from '../context/AdminAuthContext';

export default function AdminsPage() {
  const queryClient = useQueryClient();
  const { user } = useAdminAuth();
  const [email, setEmail] = useState('');

  const { data, isLoading } = useQuery({
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

  return (
    <div>
      <h1 className="font-['Playfair_Display'] text-2xl font-bold mb-1">Admins</h1>
      <p className="text-sm text-muted-foreground mb-6">Platform administrators</p>

      <form onSubmit={handleInvite} className="flex flex-col sm:flex-row gap-3 mb-8">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email do novo admin..."
          required
          className="flex-1 px-3 py-2.5 rounded-lg bg-card border border-border text-sm font-['DM_Mono'] text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary transition-colors"
        />
        <button
          type="submit"
          disabled={inviteMutation.isPending}
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary-hover transition-colors disabled:opacity-50"
        >
          <UserPlus size={16} />
          Convidar Admin
        </button>
      </form>

      <div className="bg-card border border-border rounded-2xl p-5">
        {/* Desktop table header */}
        <div className="hidden md:grid grid-cols-[2fr_2fr_1.5fr_0.5fr] gap-2 text-[0.7rem] text-muted-foreground uppercase tracking-wider pb-3 border-b border-border">
          <span>Email</span>
          <span>Invited By</span>
          <span>Added</span>
          <span></span>
        </div>

        {isLoading ? (
          <p className="text-sm text-dim-foreground py-4">Loading...</p>
        ) : (
          (data?.admins || []).map((admin) => {
            const isSelf = admin.user_id === user?.id;
            return (
              <div key={admin.id} className="border-b border-border/50 py-3 md:grid md:grid-cols-[2fr_2fr_1.5fr_0.5fr] md:gap-2 md:items-center">
                {/* Mobile card */}
                <div className="md:hidden flex items-center justify-between">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm text-foreground">{admin.email}</span>
                    <span className="text-xs text-muted-foreground">
                      {admin.invited_by_email ? `By ${admin.invited_by_email}` : '—'} · {new Date(admin.created_at).toLocaleDateString('pt-BR')}
                    </span>
                  </div>
                  {!isSelf && (
                    <button
                      onClick={() => removeMutation.mutate(admin.id)}
                      disabled={removeMutation.isPending}
                      className="text-dim-foreground hover:text-destructive transition-colors disabled:opacity-50 p-1"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                {/* Desktop row */}
                <span className="hidden md:inline text-sm text-foreground">{admin.email}</span>
                <span className="hidden md:inline text-sm text-muted-foreground">{admin.invited_by_email || '—'}</span>
                <span className="hidden md:inline text-sm text-muted-foreground">
                  {new Date(admin.created_at).toLocaleDateString('pt-BR')}
                </span>
                <span className="hidden md:inline">
                  {!isSelf && (
                    <button
                      onClick={() => removeMutation.mutate(admin.id)}
                      disabled={removeMutation.isPending}
                      className="text-dim-foreground hover:text-destructive transition-colors disabled:opacity-50"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
