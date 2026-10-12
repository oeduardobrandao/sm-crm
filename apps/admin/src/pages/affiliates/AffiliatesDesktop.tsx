import { HandCoins } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { AffiliateCommissionRuleRow, AffiliateListItem } from '../../lib/api';
import { affiliateDetailPath } from '../../lib/routes';
import { formatMoney } from '../../lib/subscription';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { RowLink } from '../../components/RowLink';
import { GlassPanel } from '../../components/shell/GlassPanel';
import { KpiGrid, KpiTile } from '../../components/shell/KpiTile';
import { Skeleton } from '../../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { CommissionRulesCard } from './CommissionRulesCard';
import type { CommissionRulesEditor } from './commission-rules';
import { AffiliateAvatar, PayoutBadges } from './affiliate-view';

const HEAD = 'text-[0.7rem] uppercase tracking-wider';

export interface AffiliateTotals {
  available: number;
  pending: number;
  paidOut: number;
  paying: number;
  referrals: number;
}

export interface AffiliatesViewProps {
  /** Já ordenados por saldo disponível. */
  affiliates: AffiliateListItem[];
  rules: AffiliateCommissionRuleRow[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  totals: AffiliateTotals;
  editor: CommissionRulesEditor;
  /** Phone only: the commission rules sheet. */
  rulesOpen: boolean;
  onRulesOpenChange: (open: boolean) => void;
}

export function AffiliatesDesktop({
  affiliates,
  rules,
  isLoading,
  isError,
  onRetry,
  totals,
  editor,
}: AffiliatesViewProps) {
  const navigate = useNavigate();
  const ready = !isLoading && !isError && affiliates.length > 0;

  return (
    <div>
      <PageHeader
        title="Afiliados"
        description={
          affiliates.length > 0
            ? `${affiliates.length} afiliados · ${formatMoney(totals.available)} disponível para repasse`
            : 'Programa de afiliados (comissão sobre pagamentos Stripe, repasse por Stripe Connect)'
        }
      />

      {ready && (
        <KpiGrid>
          <KpiTile
            label="Disponível"
            value={formatMoney(totals.available)}
            sub="repasse todo dia 5"
          />
          <KpiTile label="Pendente" value={formatMoney(totals.pending)} />
          <KpiTile label="Já pago" value={formatMoney(totals.paidOut)} />
          <KpiTile
            label="Assinantes indicados"
            value={totals.paying}
            sub={`de ${totals.referrals} indicações`}
          />
        </KpiGrid>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_440px]">
        <GlassPanel flush title="Por saldo disponível" titleId="affiliates-list-title">
          {isLoading ? (
            <div className="flex flex-col gap-3 px-[18px] pb-5">
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-4 w-56" />
              <Skeleton className="h-4 w-60" />
            </div>
          ) : isError ? (
            <ErrorState message="Não foi possível carregar os afiliados." onRetry={onRetry} />
          ) : affiliates.length === 0 ? (
            <EmptyState
              icon={HandCoins}
              title="Nenhum afiliado ainda"
              description="Os cadastros feitos em /afiliados aparecem aqui."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={HEAD}>Afiliado</TableHead>
                  <TableHead className={HEAD}>Código</TableHead>
                  <TableHead className={HEAD}>Indicações</TableHead>
                  <TableHead className={HEAD}>Assinantes</TableHead>
                  <TableHead className={HEAD}>Repasse</TableHead>
                  <TableHead className={HEAD}>Disponível</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {affiliates.map((a) => {
                  const to = affiliateDetailPath(a.id);
                  return (
                    <TableRow key={a.id} className="cursor-pointer" onClick={() => navigate(to)}>
                      <TableCell>
                        <div className="flex min-w-0 items-center gap-3">
                          <AffiliateAvatar name={a.nome} />
                          <div className="min-w-0">
                            <RowLink to={to} className="block truncate text-sm">
                              {a.nome}
                            </RowLink>
                            <span className="block truncate text-xs text-muted-foreground">
                              {a.email}
                            </span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-sm">{a.code}</TableCell>
                      <TableCell className="text-sm">{a.summary.referrals_count}</TableCell>
                      <TableCell className="text-sm">{a.summary.paying_count}</TableCell>
                      <TableCell>
                        <PayoutBadges a={a} />
                      </TableCell>
                      <TableCell className="text-sm font-medium">
                        {formatMoney(a.summary.available_cents)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </GlassPanel>

        {rules.length > 0 && <CommissionRulesCard rules={rules} editor={editor} />}
      </div>
    </div>
  );
}
