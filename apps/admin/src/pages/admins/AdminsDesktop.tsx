import { Users } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { GlassPanel } from '../../components/shell/GlassPanel';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Skeleton } from '../../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { formatAdminDate, INVITE_HELP, type AdminsViewProps } from './types';

const AVATAR_TONES = [
  'bg-primary',
  'bg-sky-400',
  'bg-success',
  'bg-violet-400',
  'bg-pink-400',
  'bg-orange-400',
];

function listTitle(count: number): string {
  return `${count} ${count === 1 ? 'admin' : 'admins'}`;
}

export function AdminsDesktop({
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
  return (
    <div className="mx-auto max-w-[860px]">
      <PageHeader title="Admins" description="Administradores da plataforma" />

      <GlassPanel title="Convidar" titleId="admins-invite" className="mb-4">
        <form onSubmit={onInvite} className="flex flex-wrap gap-2.5">
          <Input
            type="email"
            aria-label="E-mail do novo admin"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            placeholder="E-mail do novo admin"
            required
            className="min-w-[220px] flex-1 basis-[260px]"
          />
          <Button type="submit" disabled={inviting}>
            Convidar
          </Button>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">{INVITE_HELP}</p>
      </GlassPanel>

      <GlassPanel
        title={isLoading || isError ? 'Admins' : listTitle(admins.length)}
        titleId="admins-list"
        flush
      >
        {isLoading ? (
          <div className="flex flex-col gap-3 px-[18px] pb-5">
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-4 w-60" />
          </div>
        ) : isError ? (
          <ErrorState message="Não foi possível carregar os admins." onRetry={onRetry} />
        ) : admins.length === 0 ? (
          <EmptyState icon={Users} title="Nenhum admin cadastrado" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[0.7rem] uppercase tracking-wider">Admin</TableHead>
                <TableHead className="text-[0.7rem] uppercase tracking-wider">Desde</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {admins.map((admin, index) => {
                const isSelf = admin.user_id === currentUserId;
                return (
                  <TableRow key={admin.id}>
                    <TableCell>
                      <span className="flex items-center gap-2.5">
                        <span
                          aria-hidden="true"
                          className={`inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-xs font-bold text-neutral-900 ${AVATAR_TONES[index % AVATAR_TONES.length]}`}
                        >
                          {admin.email.charAt(0).toUpperCase()}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm text-foreground">{admin.email}</span>
                          {admin.invited_by_email ? (
                            <span className="block text-xs text-muted-foreground">
                              por {admin.invited_by_email}
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatAdminDate(admin.created_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      {isSelf ? (
                        <Badge variant="primary">Você</Badge>
                      ) : (
                        <Button
                          variant="destructive"
                          size="sm"
                          aria-label={`Remover ${admin.email}`}
                          onClick={() => onRemove(admin.id)}
                          disabled={removing}
                        >
                          Remover
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </GlassPanel>
    </div>
  );
}
