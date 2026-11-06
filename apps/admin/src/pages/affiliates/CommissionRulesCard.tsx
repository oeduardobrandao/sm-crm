import type { AffiliateCommissionRuleRow } from '../../lib/api';
import { formatRateBps } from '../../lib/affiliates';
import { formatMoney } from '../../lib/subscription';
import { GlassPanel } from '../../components/shell/GlassPanel';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { perReferralCents, type CommissionRulesEditor } from './commission-rules';

const HEAD = 'text-[0.7rem] uppercase tracking-wider';

/**
 * Tabela de comissões por plano (painel lateral do desktop). Uma mudança vale para os
 * pagamentos seguintes; comissões já registradas guardam o percentual da época.
 */
export function CommissionRulesCard({
  rules,
  editor,
}: {
  rules: AffiliateCommissionRuleRow[];
  editor: CommissionRulesEditor;
}) {
  return (
    <GlassPanel flush title="Tabela de comissões" titleId="commission-rules-title">
      <p className="px-[18px] pb-3 text-xs text-muted-foreground">
        Percentual sobre os primeiros meses pagos de cada indicado (cartão, Stripe). Mudanças valem
        para os próximos pagamentos.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className={HEAD}>Plano</TableHead>
            <TableHead className={HEAD}>Comissão (%)</TableHead>
            <TableHead className={HEAD}>Meses</TableHead>
            <TableHead className="w-20" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rules.map((r) => {
            const v = editor.valueOf(r);
            const dirty = editor.isDirty(r);
            return (
              <TableRow key={r.plan_id}>
                <TableCell>
                  <span className="block text-sm font-medium">{r.plan_name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {formatMoney(r.price_brl ?? 0)}/mês
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {r.configured
                      ? `${formatMoney(perReferralCents(r))} por indicado · ${formatRateBps(r.rate_bps)} × ${r.months} meses`
                      : 'Sem comissão'}
                  </span>
                </TableCell>
                <TableCell>
                  <Input
                    aria-label={`Comissão do plano ${r.plan_name}`}
                    inputMode="decimal"
                    className="h-8 w-16"
                    value={v.rate}
                    onChange={(e) => editor.setField(r, 'rate', e.target.value)}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    aria-label={`Meses do plano ${r.plan_name}`}
                    inputMode="numeric"
                    className="h-8 w-14"
                    value={v.months}
                    onChange={(e) => editor.setField(r, 'months', e.target.value)}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant={dirty ? 'default' : 'outline'}
                    disabled={!dirty || editor.isPending}
                    onClick={() => editor.submitOne(r)}
                  >
                    Salvar
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </GlassPanel>
  );
}
