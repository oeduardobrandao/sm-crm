import type { McpKeyRow, OAuthGrantRow, Plan, WorkspaceDetail, WorkspaceNote } from '../../lib/api';

/** A revocable list (MCP keys, OAuth grants) with the page's handlers for it. */
export interface ConnectionsModel<T> {
  visible: T[];
  activeCount: number;
  revokedCount: number;
  showRevoked: boolean;
  onToggleRevoked: () => void;
  onRevoke: (id: string) => void;
  revokePending: boolean;
  onRevokeAll: () => void;
  revokeAllPending: boolean;
}

/** Notes thread: every admin's notes plus the composer for a new one. */
export interface NotesModel {
  /** Newest first; undefined while the first load is in flight. */
  items: WorkspaceNote[] | undefined;
  loadError: boolean;
  draft: string;
  onDraftChange: (draft: string) => void;
  onAdd: () => void;
  addPending: boolean;
  onDelete: (noteId: string) => void;
  /** The note whose delete is in flight. */
  deletingId: string | null;
}

/** Everything the phone and desktop views render; data and handlers live in the page. */
export interface WorkspaceDetailViewProps {
  workspaceId: string;
  data: WorkspaceDetail;
  plans: Plan[];
  /** The plan picked in the plan control (the base of every override). */
  plan: Plan | undefined;
  selectedPlanId: string;
  onPlanChange: (planId: string) => void;
  onUnsetComp: () => void;
  unsetPending: boolean;
  /** Teste sem cartão (plan_source 'trial'): opens the extend dialog. */
  onExtendTrial: () => void;
  /** Ends the teste sem cartão now, after a confirm. */
  onEndTrial: () => void;
  endTrialPending: boolean;
  /** Re-sends the demo owner's set-password e-mail (only offered when demo_created_at is set). */
  onResendAccess: () => void;
  resendPending: boolean;
  notes: NotesModel;
  onOpenLimits: () => void;
  onOpenFeatures: () => void;
  resourceOverrideCount: number;
  featureOverrideCount: number;
  activeFeatureCount: number;
  isOverridden: (key: string, type: 'resource' | 'feature') => boolean;
  mcpKeys: ConnectionsModel<McpKeyRow>;
  oauthGrants: ConnectionsModel<OAuthGrantRow>;
}
