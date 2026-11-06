// Phone face of WorkspaceInvitesCard: rows for the caller's GroupedList plus a sheet with the
// list and the invite form. State, queries and confirms stay in the card.
import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { BottomSheet, Cell, FormRow, GroupedList, SegmentedControl } from '@mesaas/ios-kit';
import type { InviteInfo } from '../../lib/api';
import { authStateLabel, canActOnInvite, statusTags } from '../workspace-invites';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { roleLabel } from './roles';

type Role = 'admin' | 'agent';

export interface InvitesPhoneProps {
  invites: InviteInfo[];
  shownInvites: InviteInfo[];
  total: number;
  hiddenCount: number;
  expanded: boolean;
  onToggleExpanded: () => void;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  busyId: string | null;
  onResend: (inviteId: string) => void;
  onCancel: (inviteId: string) => void;
  formOpen: boolean;
  onOpenForm: () => void;
  /** Descartar: hides the form and clears the draft. */
  onCloseForm: () => void;
  /** Dismissing the sheet: hides the form but keeps the typed e-mail and role. */
  onHideForm: () => void;
  email: string;
  onEmailChange: (email: string) => void;
  role: Role;
  onRoleChange: (role: Role) => void;
  onSubmit: () => void;
  createPending: boolean;
}

function formatSent(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
}

export function InvitesPhone(props: InvitesPhoneProps) {
  const [open, setOpen] = useState(false);
  const pending = props.invites.filter((i) => i.status === 'pending').length;
  // The pending count is only exact when every invite is loaded; a truncated list shows the
  // server's total instead of undercounting.
  const complete = props.total <= props.invites.length;
  const summary = props.isLoading
    ? undefined
    : complete && pending > 0
      ? `${pending} ${pending === 1 ? 'pendente' : 'pendentes'}`
      : String(props.total);

  // Swiping the sheet away is not a discard: the draft survives for the next "Convidar".
  const close = (next: boolean) => {
    setOpen(next);
    if (!next) props.onHideForm();
  };

  return (
    <>
      <Cell
        label="Convites"
        value={summary}
        chevron
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      />
      <Cell
        label="Convidar"
        icon={<UserPlus aria-hidden="true" />}
        aria-haspopup="dialog"
        onClick={() => {
          props.onOpenForm();
          setOpen(true);
        }}
      />
      <BottomSheet
        open={open}
        onOpenChange={close}
        popOnUnmount
        title={`Convites (${props.total})`}
        description={
          props.total > props.invites.length
            ? `mostrando ${props.invites.length} de ${props.total}`
            : undefined
        }
      >
        {props.formOpen ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              props.onSubmit();
            }}
          >
            <GroupedList header="Novo convite">
              <FormRow
                label="E-mail"
                input={{
                  type: 'email',
                  required: true,
                  value: props.email,
                  onChange: (e) => props.onEmailChange(e.target.value),
                  placeholder: 'pessoa@exemplo.com',
                  autoComplete: 'off',
                }}
              />
              <li className="phone-cell px-4 py-2">
                <SegmentedControl
                  aria-label="Papel"
                  value={props.role}
                  onChange={props.onRoleChange}
                  options={[
                    { value: 'agent', label: 'Agente' },
                    { value: 'admin', label: 'Admin' },
                  ]}
                />
              </li>
            </GroupedList>
            <div className="mb-5 flex gap-2">
              <Button type="submit" className="flex-1" disabled={props.createPending}>
                Enviar
              </Button>
              <Button type="button" variant="secondary" onClick={props.onCloseForm}>
                Descartar
              </Button>
            </div>
          </form>
        ) : (
          <GroupedList aria-label="Ações de convite">
            <Cell
              label="+ Convidar"
              icon={<UserPlus aria-hidden="true" />}
              onClick={props.onOpenForm}
            />
          </GroupedList>
        )}

        {props.isLoading ? (
          <p className="px-4 text-sm text-muted-foreground">Carregando convites…</p>
        ) : props.isError ? (
          <GroupedList footer="Falha ao carregar convites.">
            <Cell label="Tentar novamente" onClick={props.onRetry} />
          </GroupedList>
        ) : props.invites.length === 0 ? (
          <p className="px-4 text-sm text-muted-foreground">Nenhum convite</p>
        ) : (
          <GroupedList header="Convites">
            {props.shownInvites.map((it) => (
              <InviteCell
                key={it.id}
                invite={it}
                busy={props.busyId === it.id}
                onResend={() => props.onResend(it.id)}
                onCancel={() => props.onCancel(it.id)}
              />
            ))}
            {props.hiddenCount > 0 && (
              <Cell
                label={props.expanded ? 'Ver menos' : `Ver mais (${props.hiddenCount})`}
                aria-expanded={props.expanded}
                onClick={props.onToggleExpanded}
              />
            )}
          </GroupedList>
        )}
      </BottomSheet>
    </>
  );
}

function InviteCell({
  invite,
  busy,
  onResend,
  onCancel,
}: {
  invite: InviteInfo;
  busy: boolean;
  onResend: () => void;
  onCancel: () => void;
}) {
  const tags = statusTags(invite);
  const auth = authStateLabel(invite.auth_state);
  return (
    <Cell
      label={invite.email}
      subtitle={
        <span className="flex flex-col gap-1">
          {/* whitespace-normal: the kit's subtitle is nowrap, which clipped this line mid-word. */}
          <span className="whitespace-normal">
            {roleLabel(invite.role)} · {formatSent(invite.created_at)}
            {auth ? ` · ${auth}` : ''}
          </span>
          <span className="flex flex-wrap gap-1">
            <Badge
              size="sm"
              variant={
                invite.status === 'accepted'
                  ? 'success'
                  : invite.status === 'expired'
                    ? 'neutral'
                    : 'warning'
              }
            >
              {invite.status}
            </Badge>
            {tags.map((t) => (
              <Badge key={t} variant="warning" size="sm">
                {t}
              </Badge>
            ))}
          </span>
          {canActOnInvite(invite) && (
            <span className="flex gap-2 pt-1">
              <Button size="sm" variant="secondary" onClick={onResend} disabled={busy}>
                Reenviar
              </Button>
              <Button size="sm" variant="destructive" onClick={onCancel} disabled={busy}>
                Cancelar
              </Button>
            </span>
          )}
        </span>
      }
    />
  );
}
