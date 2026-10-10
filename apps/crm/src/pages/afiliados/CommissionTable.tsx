import { formatBRL } from '@/services/affiliates';
import { formatRate, monthsPhrase, type CommissionTableRow } from './simulator';

/** Tabela de comissões por plano: percentual, janela e quanto rende cada indicado. */
export default function CommissionTable({
  rows,
  isLoading,
}: {
  rows: CommissionTableRow[];
  isLoading?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
      <h2 className="mb-1 text-lg font-semibold">Tabela de comissões</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Quanto você recebe por cada pessoa que assinar pelo seu link, conforme o plano.
      </p>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Tabela indisponível no momento.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-2 pr-4 font-medium">Plano</th>
                <th className="py-2 pr-4 font-medium">Mensalidade</th>
                <th className="py-2 pr-4 font-medium">Comissão</th>
                <th className="py-2 font-medium">Por indicado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.planId} className="border-t border-border">
                  <td className="py-2 pr-4 font-medium">{r.planName}</td>
                  <td className="py-2 pr-4">{formatBRL(r.priceCents)}</td>
                  <td className="py-2 pr-4">
                    {formatRate(r.rateBps)}{' '}
                    <span className="text-muted-foreground">{monthsPhrase(r.months)}</span>
                  </td>
                  <td className="py-2">
                    <span className="font-medium">{formatBRL(r.perReferralCents)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {formatBRL(r.perMonthCents)}/mês × {r.months}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Valores para o plano mensal pago com cartão. No plano anual à vista, a comissão vale sobre a
        parte do valor que corresponde aos mesmos meses.
      </p>
    </div>
  );
}
