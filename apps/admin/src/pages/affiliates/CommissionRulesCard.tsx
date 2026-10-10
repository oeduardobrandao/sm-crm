import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  updateAffiliateCommissionRule,
  type AffiliateCommissionRuleRow,
  type UpdateAffiliateCommissionRuleParams,
} from '../../lib/api';
import { formatRateBps, parsePercentToBps } from '../../lib/affiliates';
import { formatMoney } from '../../lib/subscription';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';

const HEAD = 'text-[0.7rem] uppercase tracking-wider';

type Edit = { rate: string; months: string };

/**
 * Tabela de comissões por plano. Uma mudança vale para os pagamentos seguintes; comissões já
 * registradas guardam o percentual da época.
 */
export function CommissionRulesCard({ rules }: { rules: AffiliateCommissionRuleRow[] }) {
  const queryClient = useQueryClient();
  const [edits, setEdits] = useState<Record<string, Edit>>({});

  const valueOf = (r: AffiliateCommissionRuleRow): Edit =>
    edits[r.plan_id] ?? {
      rate: String(r.rate_bps / 100).replace('.', ','),
      months: r.months > 0 ? String(r.months) : '',
    };

  const save = useMutation({
    mutationFn: (params: UpdateAffiliateCommissionRuleParams) =>
      updateAffiliateCommissionRule(params),
    onSuccess: (_data, vars) => {
      setEdits((prev) => {
        const next = { ...prev };
        delete next[vars.plan_id];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ['admin', 'affiliates'] });
      toast.success('Comissão atualizada');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const submit = (r: AffiliateCommissionRuleRow) => {
    const v = valueOf(r);
    const rateBps = parsePercentToBps(v.rate);
    const months = parseInt(v.months, 10);
    if (rateBps == null) return toast.error('Percentual inválido (0 a 100).');
    if (!Number.isInteger(months) || months < 1 || months > 120) {
      return toast.error('Meses inválidos (1 a 120).');
    }
    save.mutate({ plan_id: r.plan_id, rate_bps: rateBps, months });
  };

  return (
    <Card className="mb-6">
      <div className="px-5 pt-5">
        <h2 className="text-sm font-semibold">Tabela de comissões</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Percentual sobre os primeiros meses pagos de cada indicado (cartão, Stripe). Mudanças
          valem para os próximos pagamentos.
        </p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className={HEAD}>Plano</TableHead>
            <TableHead className={HEAD}>Mensalidade</TableHead>
            <TableHead className={HEAD}>Comissão (%)</TableHead>
            <TableHead className={HEAD}>Meses</TableHead>
            <TableHead className={HEAD}>Por indicado</TableHead>
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rules.map((r) => {
            const v = valueOf(r);
            const dirty = r.plan_id in edits;
            const price = r.price_brl ?? 0;
            const perReferral = r.configured
              ? Math.floor((price * r.rate_bps) / 10_000) * r.months
              : 0;
            return (
              <TableRow key={r.plan_id}>
                <TableCell className="text-sm font-medium">{r.plan_name}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatMoney(price)}
                </TableCell>
                <TableCell>
                  <Input
                    aria-label={`Comissão do plano ${r.plan_name}`}
                    inputMode="decimal"
                    className="h-8 w-20"
                    value={v.rate}
                    onChange={(e) =>
                      setEdits((prev) => ({ ...prev, [r.plan_id]: { ...v, rate: e.target.value } }))
                    }
                  />
                </TableCell>
                <TableCell>
                  <Input
                    aria-label={`Meses do plano ${r.plan_name}`}
                    inputMode="numeric"
                    className="h-8 w-16"
                    value={v.months}
                    onChange={(e) =>
                      setEdits((prev) => ({
                        ...prev,
                        [r.plan_id]: { ...v, months: e.target.value },
                      }))
                    }
                  />
                </TableCell>
                <TableCell className="text-sm">
                  {r.configured ? (
                    <>
                      {formatMoney(perReferral)}
                      <span className="block text-xs text-muted-foreground">
                        {formatRateBps(r.rate_bps)} × {r.months} meses
                      </span>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">Sem comissão</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant={dirty ? 'default' : 'outline'}
                    disabled={!dirty || save.isPending}
                    onClick={() => submit(r)}
                  >
                    Salvar
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
