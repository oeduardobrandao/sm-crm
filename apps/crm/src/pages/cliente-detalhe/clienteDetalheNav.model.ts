export type NavSectionKey =
  | 'info'
  | 'entregas'
  | 'historico'
  | 'instagram'
  | 'tiktok'
  | 'relatorio'
  | 'hub'
  | 'arquivos'
  | 'datas'
  | 'enderecos'
  | 'financeiro';

export type NavActionKey = 'connectInstagram' | 'analytics' | 'openHub' | 'editar';

export interface NavSectionItem {
  key: NavSectionKey;
  /** DOM id of the target section card. */
  id: string;
}

export interface NavActionItem {
  key: NavActionKey;
  onClick: () => void;
}

export interface IgSummaryLike {
  account?: { last_synced_at?: string | null } | null;
}

export interface HubTokenLike {
  is_active: boolean;
  expires_at: string;
  token: string;
}

export interface NavHandlers {
  onConnectInstagram: () => void;
  onAnalytics: () => void;
  onOpenHub: () => void;
  onEditar: () => void;
}

export interface BuildNavModelInput {
  isAgent: boolean;
  /**
   * Separate from `isAgent` on purpose: Relatório and Hub stay role-based while
   * Financeiro becomes capability-based. A restricted ADMIN keeps the first two.
   */
  canSeeFinancials: boolean;
  activeDeliveriesCount: number;
  deliveryHistoryCount: number;
  igSummary: IgSummaryLike | null | undefined;
  hubToken: HubTokenLike | null | undefined;
  workspaceSlug: string | undefined;
  contaId: string | null | undefined;
  /** feature_tiktok entitlement — the TikTok nav section only appears when true. */
  featureTiktok: boolean;
  /** Current time in ms; injected so expiry logic is testable. */
  now: number;
  handlers: NavHandlers;
}

export const SECTION_IDS: Record<NavSectionKey, string> = {
  info: 'sec-info',
  entregas: 'sec-entregas',
  historico: 'sec-historico',
  instagram: 'ig-container',
  tiktok: 'tiktok-container',
  relatorio: 'sec-relatorio',
  hub: 'sec-hub',
  arquivos: 'sec-arquivos',
  datas: 'sec-datas',
  enderecos: 'sec-enderecos',
  financeiro: 'sec-financeiro',
};

export function buildNavModel(input: BuildNavModelInput): {
  sections: NavSectionItem[];
  actions: NavActionItem[];
} {
  const {
    isAgent,
    canSeeFinancials,
    activeDeliveriesCount,
    deliveryHistoryCount,
    igSummary,
    hubToken,
    workspaceSlug,
    contaId,
    featureTiktok,
    now,
    handlers,
  } = input;

  const sections: NavSectionItem[] = [];
  const addSection = (key: NavSectionKey, present: boolean) => {
    if (present) sections.push({ key, id: SECTION_IDS[key] });
  };

  addSection('info', true);
  addSection('entregas', activeDeliveriesCount > 0);
  addSection('historico', deliveryHistoryCount > 0);
  addSection('instagram', true);
  addSection('tiktok', featureTiktok);
  addSection('relatorio', !isAgent);
  addSection('hub', isAgent || (!!contaId && !!workspaceSlug));
  addSection('arquivos', true);
  addSection('datas', true);
  addSection('enderecos', true);
  addSection('financeiro', canSeeFinancials);

  const igDisconnected = !igSummary;
  const igSynced = !!igSummary?.account?.last_synced_at;
  const hubOpenable =
    !!hubToken?.is_active && !!workspaceSlug && new Date(hubToken.expires_at).getTime() > now;

  const actions: NavActionItem[] = [];
  if (igDisconnected)
    actions.push({ key: 'connectInstagram', onClick: handlers.onConnectInstagram });
  if (igSynced) actions.push({ key: 'analytics', onClick: handlers.onAnalytics });
  if (hubOpenable) actions.push({ key: 'openHub', onClick: handlers.onOpenHub });
  actions.push({ key: 'editar', onClick: handlers.onEditar });

  return { sections, actions };
}
