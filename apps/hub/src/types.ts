import type { ContentFormat } from '@mesaas/platforms';
export interface WorkspaceInfo {
  name: string;
  logo_url: string | null;
  brand_color: string;
}

export interface HubThemeInfo {
  customized: boolean;
  surface: string;
  font_display: string;
  font_body: string;
  radius: string;
  card_style: string;
  logo_style: string; // 'round' | 'wordmark'
  logo_dark_url: string | null;
  hide_branding: boolean;
  default_appearance: string; // 'light' | 'dark'
}

export interface HubBootstrap {
  workspace: WorkspaceInfo;
  cliente_nome: string;
  /** The client's connected Instagram avatar; null when no account is linked. */
  cliente_foto_url: string | null;
  is_active: boolean;
  cliente_id: number;
  feature_mensagens: boolean;
  /**
   * Gravação de áudio no briefing (planos Pro e Max). Optional porque um bundle
   * novo pode falar com um hub-bootstrap ainda antigo: ausente = desligado.
   */
  feature_briefing_audio?: boolean;
  /**
   * Agenda compartilhada com o cliente (plano com feature_agenda). Optional for the same
   * reason: a hub-bootstrap deployed before the Agenda omits it, which means off.
   */
  feature_agenda?: boolean;
  /** Absent on a stale/pre-migration bootstrap response — treat as neutral (no customization). */
  hub_theme?: HubThemeInfo;
}

export interface HubPostMedia {
  id: number;
  post_id: number;
  kind: 'image' | 'video';
  mime_type: string;
  url: string | null;
  thumbnail_url: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  is_cover: boolean;
  sort_order: number;
  blur_data_url?: string | null;
  playback?: { hls: string; expires_at: string } | null;
  /** ISO timestamp when this file was permanently lost (Aug 2026 R2 incident and any
   * future reconciliation); null when the file is fine. Optional only because a
   * response cached before this field shipped omits the key — check the value,
   * never key presence. */
  media_lost_at?: string | null;
}

/** Why a post the client already saw is back with the agency (Hub-only, never stored). */
export type EmProducaoReason = 'proxima_aprovacao' | 'correcao' | 'ajuste';

export interface HubPost {
  id: number;
  titulo: string;
  tipo: ContentFormat;
  /** Target platform(s) for publishing. Absent on stale/pre-migration cached payloads —
   * treat as 'instagram' (mirrors the DB default). */
  platform?: 'instagram' | 'tiktok' | 'both';
  /** Reel de teste (Instagram trial reel): publicado só para não-seguidores até
   * a graduação. Absent em payloads antigos em cache — tratar como null. */
  ig_trial_strategy?: 'manual' | 'auto' | null;
  status:
    | 'rascunho'
    | 'revisao_interna'
    | 'aprovado_interno'
    | 'enviado_cliente'
    | 'aprovado_cliente'
    | 'correcao_cliente'
    | 'agendado'
    | 'postado'
    | 'falha_publicacao';
  ordem: number;
  conteudo: Record<string, unknown> | null;
  conteudo_plain: string;
  scheduled_at: string | null;
  ig_caption: string | null;
  instagram_permalink: string | null;
  tiktok_post_url?: string | null;
  published_at: string | null;
  publish_error: string | null;
  /** Set when the storage auto-clean removed this post's media after
   * publication — an empty media list then means "removed", not "none yet". */
  media_autocleaned_at?: string | null;
  /** Null for a post created outside any fluxo ("avulso") — arrives paired with a null
   * workflow_titulo/workflow_created_at, including for clients with zero fluxos. */
  workflow_id: number | null;
  workflow_titulo: string | null;
  workflow_created_at: string | null;
  media: HubPostMedia[];
  cover_media: HubPostMedia | null;
  pending_suggestion: PendingEditSuggestion | null;
  suggestion_rejected_at: string | null;
  /** Set by hub-posts when the post is back in an internal status after the client
   * saw it. Absent on stale cached payloads and before the function deploy: treat
   * as null (not in production). */
  em_producao?: EmProducaoReason | null;
}

export interface HubPostProperty {
  post_id: number;
  value: unknown;
  template_property_definitions: {
    name: string;
    type: string;
    config: { options?: { id: string; label: string; color: string }[] };
    portal_visible: boolean;
    display_order: number;
  };
}

export interface HubSelectOption {
  workflow_id: number;
  property_definition_id: number;
  option_id: string;
  label: string;
  color: string;
}

export interface PendingEditSuggestion {
  id: number;
  suggested_conteudo: Record<string, unknown> | null;
  suggested_conteudo_plain: string;
  suggested_ig_caption: string | null;
  changed_fields: string[];
  updated_at: string;
}

export interface PostApproval {
  id: number;
  post_id: number;
  action: 'aprovado' | 'correcao' | 'mensagem';
  comentario: string | null;
  is_workspace_user: boolean;
  created_at: string;
  motivo?: CorrectionReason | null;
}

export type CorrectionReason = 'midia' | 'texto' | 'legenda' | 'outro';

/** hub-post-history DTO. Sanitized server-side: no from_status, no actor names, no TipTap JSON. */
export interface PostHistoryEvent {
  id: number;
  to_status:
    | 'enviado_cliente'
    | 'aprovado_cliente'
    | 'correcao_cliente'
    | 'agendado'
    | 'postado'
    | 'falha_publicacao';
  source: 'client' | 'team' | 'system';
  created_at: string;
  post_approval_id: number | null;
  /** Present only on enviado_cliente events: the text the client saw on that send. */
  snapshot: { conteudo_plain: string | null; ig_caption: string | null } | null;
}

export interface PostHistoryApproval {
  id: number;
  action: 'aprovado' | 'correcao' | 'mensagem';
  comentario: string | null;
  motivo: CorrectionReason | null;
  is_workspace_user: boolean;
  created_at: string;
}

export interface PostHistoryResponse {
  events: PostHistoryEvent[];
  approvals: PostHistoryApproval[];
}

export interface HubBrand {
  id: string;
  cliente_id: number;
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  font_primary: string | null;
  font_secondary: string | null;
}

export interface HubBrandFile {
  id: string;
  cliente_id: number;
  name: string;
  file_url: string;
  file_type: string;
  display_order: number;
}

export interface HubPage {
  id: string;
  title: string;
  display_order: number;
  created_at: string;
}

export interface HubPageFull extends HubPage {
  content: HubContentBlock[];
}

export interface HubLegacyBlock {
  type: 'paragraph' | 'heading' | 'image' | 'link' | 'markdown';
  content: string;
  href?: string;
  level?: 1 | 2 | 3;
}

export interface HubRichTextBlock {
  type: 'richtext';
  /** Documento ProseMirror do TipTap. Lido por `RichTextContent`. */
  doc: Record<string, unknown>;
}

export type HubContentBlock = HubLegacyBlock | HubRichTextBlock;

export interface HubAudio {
  url: string;
  mime: string;
  duration_seconds: number | null;
  transcription_status: 'pending' | 'done' | 'failed' | null;
  recorded_at: string | null;
}
export type BriefingAudio = HubAudio;

export interface BriefingQuestion {
  id: string;
  question: string;
  answer: string | null;
  section: string | null;
  display_order: number;
  audio: BriefingAudio | null;
}

export interface BriefingAudioResponse {
  ok: boolean;
  answer: string | null;
  transcript: string | null;
  audio: BriefingAudio | null;
}

export interface IdeiaAudioResponse {
  ok: boolean;
  transcript: string | null;
  audio: HubAudio | null;
}

export interface Briefing {
  id: string;
  title: string;
  display_order: number;
  questions: BriefingQuestion[];
}

export interface IdeiaReaction {
  id: string;
  membro_id: number;
  emoji: string;
  membros: { nome: string };
}

export interface IdeiaImage {
  id: number;
  file_id: number;
  url: string;
  thumbnail_url: string | null;
  blur_data_url: string | null;
  width: number | null;
  height: number | null;
  sort_order: number;
}

export interface HubIdeia {
  id: string;
  titulo: string;
  // Optional: an ideia can be conveyed entirely through its audio recording instead.
  descricao: string | null;
  links: string[];
  tipo: 'ideia' | 'solicitacao';
  status: 'nova' | 'em_analise' | 'aprovada' | 'descartada' | 'convertida' | 'concluida';
  comentario_agencia: string | null;
  comentario_autor_id: number | null;
  comentario_at: string | null;
  comentario_autor: { nome: string } | null;
  created_at: string;
  updated_at: string;
  ideia_reactions: IdeiaReaction[];
  images: IdeiaImage[];
  origem: 'cliente' | 'agencia';
  audio: (HubAudio & { transcript: string | null }) | null;
}

export interface InstagramProfile {
  username: string | null;
  profilePictureUrl: string | null;
}

export interface InstagramFeedProfile extends InstagramProfile {
  followerCount: number;
  followingCount: number;
  mediaCount: number;
}

export interface InstagramFeedPost {
  id: string;
  thumbnailUrl: string | null;
  mediaType: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
  permalink: string;
  postedAt: string;
  impressions: number;
}

export interface InstagramFeedData {
  profile: InstagramFeedProfile;
  recentPosts: InstagramFeedPost[];
}

export interface HubPostsResponse {
  posts: HubPost[];
  postApprovals: PostApproval[];
  propertyValues: HubPostProperty[];
  workflowSelectOptions: HubSelectOption[];
  instagramProfile: InstagramProfile | null;
  autoPublishOnApproval?: boolean;
  /** Workflows mid dual-approval: a later client-approval etapa is still open,
   * so approving now will NOT auto-schedule (mirrors hub-approve's guard). */
  autoPublishSuspendedWorkflowIds?: number[];
  /** Posts avulsos com processo individual que ainda tem outra etapa de
   * aprovação adiante: aprovar agora NÃO autoagenda (espelha hub-approve). */
  autoPublishSuspendedPostIds?: number[];
  /** Shell only: present when published posts older than the 90-day window exist. Opaque;
   * pass it back as `before`. Absent from older backends, which return everything. */
  olderCursor?: string | null;
  /** Shell only: the window's start (ISO). Calendar months starting before it need a range fetch. */
  historyCutoff?: string | null;
  /** History pages only: the next page's cursor, null on the last page. */
  nextCursor?: string | null;
}

export interface DashboardTopPost {
  id: string;
  thumbnailUrl: string | null;
  mediaType: string;
  permalink: string;
  postedAt: string;
  likes: number;
  comments: number;
  reach: number;
  impressions: number;
  saved: number;
  shares: number;
  engagementRate: number;
}

export interface DashboardFollowerEntry {
  date: string;
  followerCount: number;
}

export interface DashboardReachEntry {
  date: string;
  reach: number;
  impressions: number;
}

export interface DashboardAccount {
  followerCount: number;
  followingCount: number;
  mediaCount: number;
  reach28d: number;
  impressions28d: number;
  lastSyncedAt: string | null;
}

export interface HubDashboardResponse {
  topPosts: DashboardTopPost[];
  followerHistory: DashboardFollowerEntry[];
  reachHistory: DashboardReachEntry[];
  account: DashboardAccount | null;
  period: number;
}

export interface MensagemFeedItem {
  source: 'post_feedback' | 'edit_suggestion' | 'mensagem';
  item_id: number;
  cliente_id: number;
  cliente_nome: string;
  post_id: number | null;
  workflow_id: number | null;
  post_titulo: string | null;
  action: string | null;
  content: string | null;
  is_workspace_user: boolean;
  author_user_id: string | null;
  author_name: string | null;
  author_avatar_url: string | null;
  created_at: string;
}

export interface HubMensagensResponse {
  items: MensagemFeedItem[];
  unread: number;
}

export interface MensagensCursor {
  before: string;
  beforeSource: MensagemFeedItem['source'];
  beforeItemId: number;
}

/** A pending reschedule request the client made for one occurrence. */
export interface HubAgendaRemarcacao {
  id: number;
  inicio_sugerido: string;
  fim_sugerido: string;
  mensagem: string | null;
  criado_em: string;
}

/**
 * The fields every Agenda card shows: an occurrence as hub-agenda returns it, minus the
 * client-only reschedule request. The guest invite page (agenda-convite) returns exactly this.
 */
export interface AgendaItemBase {
  ocorrencia_id: number;
  sequencia: number;
  inicio: string;
  fim: string;
  dia_inteiro: boolean;
  /** YYYY-MM-DD in `tz`. */
  data_inicio_local: string;
  /** YYYY-MM-DD in `tz`; exclusive for all-day occurrences. */
  data_fim_local: string;
  tz: string;
  titulo: string;
  descricao: string | null;
  local: string | null;
  link_reuniao: string | null;
  /** Effective answer: null = waiting (never answered, or the start moved since). */
  resposta: 'sim' | 'nao' | null;
}

/** One shared occurrence, as hub-agenda returns it (`Item` in the Agenda Hub plan). */
export interface HubAgendaItem extends AgendaItemBase {
  remarcacao: HubAgendaRemarcacao | null;
}

/** Keyset cursor for the next page (`apos_inicio` / `apos_id`). */
export interface HubAgendaCursor {
  inicio: string;
  id: number;
}

export interface HubAgendaResponse {
  itens: HubAgendaItem[];
  proximo: HubAgendaCursor | null;
}

// ── Guest invite (agenda-convite) ───────────────────────────────────────────

/** One occurrence on the guest invite page: `Item` without `remarcacao`; `resposta` is the guest's. */
export type ConviteItem = AgendaItemBase;

/** GET agenda-convite?token=T */
export interface ConviteResponse {
  workspace: { nome: string; brand_color: string | null; logo_url: string | null };
  /** null when the organizer is no longer a member. */
  organizador_nome: string | null;
  titulo: string;
  itens: ConviteItem[];
}
