// Desktop panels of the workspace detail, one per block of the DkWorkspaceDetalhe board.
import type { ReactNode } from 'react';
import { FEATURE_FLAG_KEYS, FEATURE_FLAG_LABELS, type MemberInfo } from '../../lib/api';
import { hasSubscription, providerLabel } from '../../lib/subscription';
import { GlassPanel } from '../../components/shell/GlassPanel';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Textarea } from '../../components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { cn } from '../../lib/utils';
import {
  LIMIT_KEYS,
  PagarmeLiveNotes,
  activeOverrides,
  formatJoined,
  formatLimit,
  limitLabel,
  roleLabel,
  subscriptionRows,
} from './shared';
import type { ConnectionsModel, WorkspaceDetailViewProps } from './types';

/** Label/value row inside a panel (iOS settings style, 44px). */
function InfoLine({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <li className="flex min-h-11 items-center justify-between gap-3 border-t border-border px-[18px] py-1.5 text-sm">
      <span className="min-w-0">{label}</span>
      <span className="min-w-0 text-right text-muted-foreground">{children}</span>
    </li>
  );
}

export function MembersPanel({ members }: { members: MemberInfo[] }) {
  return (
    <GlassPanel title={`Membros (${members.length})`} titleId="wd-members" flush>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Membro</TableHead>
              <TableHead>Telefone</TableHead>
              <TableHead>Papel</TableHead>
              <TableHead>Entrou em</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => (
              <TableRow key={m.user_id}>
                <TableCell>
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span
                      aria-hidden="true"
                      className="inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold"
                    >
                      {m.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{m.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {m.email}
                      </span>
                    </span>
                  </span>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {m.telefone ? (
                    <span className="inline-flex items-center gap-1.5">
                      {m.telefone}
                      {m.marketing_opt_in && (
                        <Badge variant="success" size="sm" title="Aceitou contato de marketing">
                          MKT
                        </Badge>
                      )}
                    </span>
                  ) : (
                    <span className="text-dim-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={m.role === 'owner' ? 'primary' : 'neutral'}>
                    {roleLabel(m.role)}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatJoined(m.joined_at)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </GlassPanel>
  );
}

export function SubscriptionPanel({ data }: Pick<WorkspaceDetailViewProps, 'data'>) {
  const sub = data.subscription;
  return (
    <GlassPanel
      title="Assinatura"
      titleId="wd-subscription"
      actions={
        <span className="text-xs text-muted-foreground">{providerLabel(sub?.provider)}</span>
      }
      flush
    >
      {hasSubscription(sub) ? (
        <>
          <ul>
            {subscriptionRows(sub).map((row) => (
              <InfoLine key={row.label} label={row.label}>
                {row.value}
              </InfoLine>
            ))}
          </ul>
          {(sub.provider === 'pagarme' || data.workspace.plan_source === 'manual') && (
            <div className="px-[18px] pb-4">
              {sub.provider === 'pagarme' && <PagarmeLiveNotes subscription={sub} />}
              {data.workspace.plan_source === 'manual' && (
                <p className="mt-3 text-xs text-muted-foreground">
                  O plano efetivo foi ajustado manualmente (comp). Os dados acima refletem a
                  assinatura real do cliente no {providerLabel(sub.provider)}.
                </p>
              )}
            </div>
          )}
        </>
      ) : (
        <p className="px-[18px] pb-4 text-sm text-muted-foreground">Sem assinatura.</p>
      )}
    </GlassPanel>
  );
}

function OverrideBadge({ count }: { count: number }) {
  return count > 0 ? (
    <Badge variant="warning" size="sm">
      {count} {count === 1 ? 'override' : 'overrides'}
    </Badge>
  ) : (
    <span className="text-xs text-dim-foreground">padrão do plano</span>
  );
}

/** "Overrides ativos": the two editors' summaries (the old SummaryCards) and each override. */
export function OverridesPanel(props: WorkspaceDetailViewProps) {
  const { data, plan, resourceOverrideCount, featureOverrideCount, activeFeatureCount } = props;
  const rows = activeOverrides(data, plan);
  return (
    <GlassPanel title="Overrides ativos" titleId="wd-overrides" flush>
      <ul>
        <InfoLine label="Limites de recursos">
          <span className="inline-flex flex-wrap items-center justify-end gap-2">
            <span>{LIMIT_KEYS.length} limites</span>
            <OverrideBadge count={resourceOverrideCount} />
            <Button size="sm" variant="secondary" onClick={props.onOpenLimits}>
              Editar limites
            </Button>
          </span>
        </InfoLine>
        <InfoLine label="Funcionalidades">
          <span className="inline-flex flex-wrap items-center justify-end gap-2">
            <span>
              {activeFeatureCount} de {FEATURE_FLAG_KEYS.length} ativas
            </span>
            <OverrideBadge count={featureOverrideCount} />
            <Button size="sm" variant="secondary" onClick={props.onOpenFeatures}>
              Editar funcionalidades
            </Button>
          </span>
        </InfoLine>
        {rows.map((r) => (
          <InfoLine key={r.key} label={r.label}>
            {r.value} <span className="text-primary">(plano: {r.planValue})</span>
          </InfoLine>
        ))}
      </ul>
    </GlassPanel>
  );
}

export function NotesPanel(props: WorkspaceDetailViewProps) {
  const { notes, onNotesChange, onSaveNotes, saveNotesPending, plan } = props;
  return (
    <GlassPanel
      title="Notas"
      titleId="wd-notes"
      actions={
        <Button
          variant="secondary"
          size="sm"
          onClick={onSaveNotes}
          disabled={saveNotesPending || !plan}
          title={!plan ? 'Atribua um plano ao workspace para salvar notas' : undefined}
        >
          {saveNotesPending ? 'Salvando…' : 'Salvar'}
        </Button>
      }
    >
      <Textarea
        value={notes}
        onChange={(e) => onNotesChange(e.target.value)}
        placeholder="Notas do admin…"
        aria-label="Notas do admin"
        rows={3}
        className="min-h-0 resize-none"
      />
    </GlassPanel>
  );
}

export function LimitsPanel(props: WorkspaceDetailViewProps) {
  const { data, plan, isOverridden, onOpenLimits } = props;
  return (
    <GlassPanel
      title="Limites de recursos"
      titleId="wd-limits"
      actions={
        <Button size="sm" variant="secondary" onClick={onOpenLimits}>
          Editar limites
        </Button>
      }
      flush
    >
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Limite</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead className="text-right">Plano</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {LIMIT_KEYS.map((key) => {
              const overridden = isOverridden(key, 'resource');
              return (
                <TableRow key={key}>
                  <TableCell className="text-sm">
                    <span className="inline-flex items-center gap-2">
                      {limitLabel(key)}
                      {overridden && (
                        <span
                          aria-label="override"
                          className="h-2 w-2 shrink-0 rounded-full bg-primary"
                        />
                      )}
                    </span>
                  </TableCell>
                  <TableCell
                    className={cn('text-right text-sm', overridden && 'font-semibold text-primary')}
                  >
                    {formatLimit(key, data.resolved_limits?.[key])}
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">
                    {plan ? formatLimit(key, plan[key] as number | null) : '—'}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </GlassPanel>
  );
}

export function FeaturesPanel(props: WorkspaceDetailViewProps) {
  const { data, isOverridden, onOpenFeatures, activeFeatureCount } = props;
  return (
    <GlassPanel
      title={`Funcionalidades · ${activeFeatureCount} de ${FEATURE_FLAG_KEYS.length} ativas`}
      titleId="wd-features"
      actions={
        <Button size="sm" variant="secondary" onClick={onOpenFeatures}>
          Editar funcionalidades
        </Button>
      }
      flush
    >
      <ul className="grid sm:grid-cols-2">
        {FEATURE_FLAG_KEYS.map((key) => {
          const on = !!data.resolved_features?.[key];
          return (
            <InfoLine
              key={key}
              label={
                <span className="inline-flex items-center gap-2">
                  {FEATURE_FLAG_LABELS[key]}
                  {isOverridden(key, 'feature') && (
                    <span
                      aria-label="override"
                      className="h-2 w-2 shrink-0 rounded-full bg-primary"
                    />
                  )}
                </span>
              }
            >
              <Badge variant={on ? 'success' : 'neutral'}>{on ? 'Ativa' : 'Inativa'}</Badge>
            </InfoLine>
          );
        })}
      </ul>
    </GlassPanel>
  );
}

interface ConnectionRow {
  id: string;
  primary: ReactNode;
  scopes: string[];
  revoked: boolean;
}

/** MCP keys and OAuth grants: same table, different first column. */
export function ConnectionsPanel<T>({
  title,
  titleId,
  firstColumn,
  emptyText,
  model,
  toRow,
}: {
  title: string;
  titleId: string;
  firstColumn: string;
  emptyText: string;
  model: ConnectionsModel<T>;
  toRow: (item: T) => ConnectionRow;
}) {
  return (
    <GlassPanel
      title={title}
      titleId={titleId}
      flush
      actions={
        <>
          {model.revokedCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              aria-pressed={model.showRevoked}
              onClick={model.onToggleRevoked}
            >
              {model.showRevoked
                ? 'Ocultar revogadas'
                : `Mostrar revogadas (${model.revokedCount})`}
            </Button>
          )}
          {model.activeCount > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={model.onRevokeAll}
              disabled={model.revokeAllPending}
            >
              Revogar todas
            </Button>
          )}
        </>
      }
    >
      {model.visible.length === 0 ? (
        <p className="px-[18px] pb-4 text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{firstColumn}</TableHead>
                <TableHead>Escopos</TableHead>
                <TableHead className="w-28 text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {model.visible.map((item) => {
                const row = toRow(item);
                return (
                  <TableRow key={row.id}>
                    <TableCell className="text-sm">{row.primary}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.scopes.join(', ')}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.revoked ? (
                        <Badge variant="neutral">revogada</Badge>
                      ) : (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => model.onRevoke(row.id)}
                          disabled={model.revokePending}
                        >
                          Revogar
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </GlassPanel>
  );
}
