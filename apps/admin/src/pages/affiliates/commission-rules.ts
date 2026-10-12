import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  updateAffiliateCommissionRule,
  type AffiliateCommissionRuleRow,
  type UpdateAffiliateCommissionRuleParams,
} from '../../lib/api';
import { formatRateBps, parsePercentToBps } from '../../lib/affiliates';

export type RuleEdit = { rate: string; months: string };

type SaveItem = { name: string; params: UpdateAffiliateCommissionRuleParams };

/** Comissão por indicado: percentual sobre a mensalidade, vezes os meses da janela. */
export function perReferralCents(r: AffiliateCommissionRuleRow): number {
  if (!r.configured) return 0;
  return Math.floor(((r.price_brl ?? 0) * r.rate_bps) / 10_000) * r.months;
}

const monthsLabel = (n: number) => `${n} ${n === 1 ? 'mês' : 'meses'}`;

function planList(names: string[]): string {
  const parts = names.map((n) => `no ${n}`);
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}`;
}

/** "30% por 6 meses no Pro e no Max": uma frase por combinação de percentual e janela. */
export function summarizeRules(rules: AffiliateCommissionRuleRow[]): string {
  const groups = new Map<string, { rate: number; months: number; names: string[] }>();
  for (const r of rules) {
    if (!r.configured) continue;
    const key = `${r.rate_bps}|${r.months}`;
    const g = groups.get(key) ?? { rate: r.rate_bps, months: r.months, names: [] };
    g.names.push(r.plan_name);
    groups.set(key, g);
  }
  if (groups.size === 0) return 'Nenhuma regra configurada';
  return [...groups.values()]
    .map((g) => `${formatRateBps(g.rate)} por ${monthsLabel(g.months)} ${planList(g.names)}`)
    .join(' · ');
}

/**
 * Edição da tabela de comissões, compartilhada pelo painel do desktop (uma linha por vez) e
 * pela folha do telefone (todas as linhas alteradas de uma vez).
 */
export function useCommissionRules() {
  const queryClient = useQueryClient();
  const [edits, setEdits] = useState<Record<string, RuleEdit>>({});

  const valueOf = (r: AffiliateCommissionRuleRow): RuleEdit =>
    edits[r.plan_id] ?? {
      rate: String(r.rate_bps / 100).replace('.', ','),
      months: r.months > 0 ? String(r.months) : '',
    };

  const setField = (r: AffiliateCommissionRuleRow, field: keyof RuleEdit, value: string) =>
    setEdits((prev) => ({ ...prev, [r.plan_id]: { ...valueOf(r), [field]: value } }));

  const isDirty = (r: AffiliateCommissionRuleRow) => r.plan_id in edits;

  /** Cada regra é salva por conta própria: quem deu certo sai de "Não salvo" mesmo se outra falhar. */
  const save = useMutation({
    mutationFn: async (batch: SaveItem[]) =>
      Promise.allSettled(batch.map((item) => updateAffiliateCommissionRule(item.params))),
    onSuccess: (results, batch) => {
      const saved = batch.filter((_, i) => results[i].status === 'fulfilled');
      const failed = batch.flatMap((item, i) => {
        const r = results[i];
        return r.status === 'rejected' ? [{ item, reason: r.reason as unknown }] : [];
      });
      if (saved.length > 0) {
        setEdits((prev) => {
          const next = { ...prev };
          for (const s of saved) delete next[s.params.plan_id];
          return next;
        });
      }
      if (failed.length === 0) {
        toast.success(saved.length > 1 ? 'Comissões atualizadas' : 'Comissão atualizada');
        return;
      }
      const names = failed.map((f) => f.item.name).join(', ');
      const first = failed[0].reason;
      const detail = first instanceof Error ? `: ${first.message}` : '';
      toast.error(`Não foi possível salvar ${names}${detail}`);
    },
    onError: (err: Error) => toast.error(err.message),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['admin', 'affiliates'] }),
  });

  /** Valida as regras e devolve os itens a salvar, ou null (com o aviso já mostrado). */
  const toItems = (rules: AffiliateCommissionRuleRow[]): SaveItem[] | null => {
    const batch: SaveItem[] = [];
    for (const r of rules) {
      const v = valueOf(r);
      const rateBps = parsePercentToBps(v.rate);
      const months = parseInt(v.months, 10);
      if (rateBps == null) {
        toast.error('Percentual inválido (0 a 100).');
        return null;
      }
      if (!Number.isInteger(months) || months < 1 || months > 120) {
        toast.error('Meses inválidos (1 a 120).');
        return null;
      }
      batch.push({ name: r.plan_name, params: { plan_id: r.plan_id, rate_bps: rateBps, months } });
    }
    return batch;
  };

  const submitOne = (r: AffiliateCommissionRuleRow) => {
    const batch = toItems([r]);
    if (batch) save.mutate(batch);
  };

  /** Salva todas as regras alteradas. Resolve true só quando todas foram salvas. */
  const submitAll = async (rules: AffiliateCommissionRuleRow[]): Promise<boolean> => {
    const dirty = rules.filter(isDirty);
    if (dirty.length === 0) return true;
    const batch = toItems(dirty);
    if (!batch) return false;
    try {
      const results = await save.mutateAsync(batch);
      return results.every((r) => r.status === 'fulfilled');
    } catch {
      return false;
    }
  };

  const discard = () => setEdits({});

  return {
    valueOf,
    setField,
    isDirty,
    dirtyCount: Object.keys(edits).length,
    submitOne,
    submitAll,
    discard,
    isPending: save.isPending,
  };
}

export type CommissionRulesEditor = ReturnType<typeof useCommissionRules>;
