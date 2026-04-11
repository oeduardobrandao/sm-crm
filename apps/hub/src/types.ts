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

export interface HubPost {
  id: number;
  titulo: string;
  tipo: 'feed' | 'reels' | 'stories' | 'carrossel';
  status: 'rascunho' | 'em_producao' | 'enviado_cliente' | 'aprovado_cliente' | 'correcao_cliente' | 'agendado' | 'publicado';
  ordem: number;
  conteudo_plain: string;
  scheduled_at: string | null;
  workflow_id: number;
}

export interface HubPostProperty {
  post_id: number;
  value: unknown;
  template_property_definitions: {
    name: string;
    type: string;
    portal_visible: boolean;
    display_order: number;
  };
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
  type: 'paragraph' | 'heading' | 'image' | 'link';
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
