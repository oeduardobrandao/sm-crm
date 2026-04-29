export interface WorkspaceInfo {
  name: string;
  logo_url: string | null;
  brand_color: string;
}

export interface HubBootstrap {
  workspace: WorkspaceInfo;
  cliente_nome: string;
  is_active: boolean;
  cliente_id: number;
}

export interface HubPostMedia {
  id: number;
  post_id: number;
  kind: 'image' | 'video';
  mime_type: string;
  url: string;
  thumbnail_url: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  is_cover: boolean;
  sort_order: number;
  blur_data_url?: string | null;
}

export interface HubPost {
  id: number;
  titulo: string;
  tipo: 'feed' | 'reels' | 'stories' | 'carrossel';
  status: 'rascunho' | 'em_producao' | 'enviado_cliente'
    | 'aprovado_cliente' | 'correcao_cliente' | 'agendado' | 'postado' | 'falha_publicacao';
  ordem: number;
  conteudo_plain: string;
  scheduled_at: string | null;
  ig_caption: string | null;
  instagram_permalink: string | null;
  published_at: string | null;
  publish_error: string | null;
  workflow_id: number;
  workflow_titulo: string;
  workflow_created_at: string;
  media: HubPostMedia[];
  cover_media: HubPostMedia | null;
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

export interface PostApproval {
  id: number;
  post_id: number;
  action: 'aprovado' | 'correcao' | 'mensagem';
  comentario: string | null;
  is_workspace_user: boolean;
  created_at: string;
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

export interface HubContentBlock {
  type: 'paragraph' | 'heading' | 'image' | 'link' | 'markdown';
  content: string;
  href?: string;
  level?: 1 | 2 | 3;
}

export interface BriefingQuestion {
  id: string;
  question: string;
  answer: string | null;
  section: string | null;
  display_order: number;
}

export interface IdeiaReaction {
  id: string;
  membro_id: number;
  emoji: string;
  membros: { nome: string };
}

export interface HubIdeia {
  id: string;
  titulo: string;
  descricao: string;
  links: string[];
  status: 'nova' | 'em_analise' | 'aprovada' | 'descartada';
  comentario_agencia: string | null;
  comentario_autor_id: number | null;
  comentario_at: string | null;
  comentario_autor: { nome: string } | null;
  created_at: string;
  updated_at: string;
  ideia_reactions: IdeiaReaction[];
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
}
