import { Trash2, Users } from 'lucide-react';
import { Cell, GroupedList, SwipeRow } from '@mesaas/ios-kit';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { GlassPanel } from '../../components/shell/GlassPanel';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import { formatAdminDate, INVITE_HELP, type AdminsViewProps } from './types';

export function AdminsPhone({
  admins,
  isLoading,
  isError,
  onRetry,
  currentUserId,
  email,
  onEmailChange,
  onInvite,
  inviting,
  onRemove,
  removing,
}: AdminsViewProps) {
  const hasRemovable = admins.some((admin) => admin.user_id !== currentUserId);

  return (
    <div>
      <PageHeader title="Admins" description="Administradores da plataforma" />

      <section className="phone-kit phone-group">
        <h2 className="phone-group__header">Convidar</h2>
        <form
          onSubmit={onInvite}
          className="phone-group__list flex items-center gap-2 py-1 pl-4 pr-1 focus-within:ring-2 focus-within:ring-ring"
        >
          <input
            type="email"
            aria-label="E-mail do novo admin"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            placeholder="E-mail do novo admin"
            required
            className="h-10 min-w-0 flex-1 bg-transparent text-[17px] text-foreground outline-none placeholder:text-muted-foreground"
          />
          <Button type="submit" disabled={inviting} className="h-10 shrink-0 rounded-xl px-3.5">
            Convidar
          </Button>
        </form>
        <p className="phone-group__footer">{INVITE_HELP}</p>
      </section>

      {isLoading ? (
        <GlassPanel>
          <div className="flex flex-col gap-3 pt-4">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-44" />
          </div>
        </GlassPanel>
      ) : isError ? (
        <GlassPanel flush>
          <ErrorState message="Não foi possível carregar os admins." onRetry={onRetry} />
        </GlassPanel>
      ) : admins.length === 0 ? (
        <GlassPanel flush>
          <EmptyState icon={Users} title="Nenhum admin cadastrado" />
        </GlassPanel>
      ) : (
        <GroupedList
          header={`${admins.length} ${admins.length === 1 ? 'admin' : 'admins'}`}
          footer={hasRemovable ? 'Deslize um admin para a esquerda para remover.' : undefined}
        >
          {admins.map((admin) => {
            const subtitle = `${admin.invited_by_email ? `Por ${admin.invited_by_email}` : 'Admin'} · ${formatAdminDate(admin.created_at)}`;
            if (admin.user_id === currentUserId) {
              return <Cell key={admin.id} label={admin.email} subtitle={subtitle} value="Você" />;
            }
            return (
              <SwipeRow
                key={admin.id}
                as="li"
                className="phone-cell"
                trailingActions={[
                  {
                    label: 'Remover',
                    ariaLabel: `Remover ${admin.email}`,
                    icon: <Trash2 />,
                    tone: 'destructive',
                    onAction: () => {
                      if (!removing) onRemove(admin.id);
                    },
                  },
                ]}
              >
                <div className="phone-cell__main">
                  <span className="phone-cell__body">
                    <span className="phone-cell__text">
                      <span className="phone-cell__label">{admin.email}</span>
                      <span className="phone-cell__subtitle">{subtitle}</span>
                    </span>
                  </span>
                </div>
              </SwipeRow>
            );
          })}
        </GroupedList>
      )}
    </div>
  );
}
