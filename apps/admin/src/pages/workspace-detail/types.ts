import type { McpKeyRow, OAuthGrantRow, Plan, WorkspaceDetail } from '../../lib/api';

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
  /** Re-sends the demo owner's set-password e-mail (only offered when demo_created_at is set). */
  onResendAccess: () => void;
  resendPending: boolean;
  notes: string;
  onNotesChange: (notes: string) => void;
  onSaveNotes: () => void;
  saveNotesPending: boolean;
  onOpenLimits: () => void;
  onOpenFeatures: () => void;
  resourceOverrideCount: number;
  featureOverrideCount: number;
  activeFeatureCount: number;
  isOverridden: (key: string, type: 'resource' | 'feature') => boolean;
  mcpKeys: ConnectionsModel<McpKeyRow>;
  oauthGrants: ConnectionsModel<OAuthGrantRow>;
}
