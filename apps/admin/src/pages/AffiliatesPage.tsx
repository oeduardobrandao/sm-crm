import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listAffiliates } from '../lib/api';
import { useIsPhone } from '../hooks/useIsPhone';
import { AffiliatesDesktop } from './affiliates/AffiliatesDesktop';
import { AffiliatesPhone } from './affiliates/AffiliatesPhone';
import { useCommissionRules } from './affiliates/commission-rules';

export default function AffiliatesPage() {
  const isPhone = useIsPhone();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'affiliates'],
    queryFn: listAffiliates,
  });
  const editor = useCommissionRules();
  // Kept here so crossing 768px with the sheet open does not lose the edits.
  const [rulesOpen, setRulesOpen] = useState(false);

  const affiliates = [...(data?.affiliates ?? [])].sort(
    (a, b) => b.summary.available_cents - a.summary.available_cents,
  );
  const sum = (pick: (a: (typeof affiliates)[number]) => number) =>
    affiliates.reduce((s, a) => s + pick(a), 0);
  const totals = {
    available: sum((a) => Math.max(0, a.summary.available_cents)),
    pending: sum((a) => Math.max(0, a.summary.pending_cents)),
    paidOut: sum((a) => a.summary.paid_out_cents),
    paying: sum((a) => a.summary.paying_count),
    referrals: sum((a) => a.summary.referrals_count),
  };

  const view = {
    affiliates,
    rules: data?.rules ?? [],
    isLoading,
    isError,
    onRetry: () => void refetch(),
    totals,
    editor,
    rulesOpen,
    onRulesOpenChange: setRulesOpen,
  };
  return isPhone ? <AffiliatesPhone {...view} /> : <AffiliatesDesktop {...view} />;
}
