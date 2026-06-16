import type { WorkflowPost } from '../../store';

export const TIPO_LABELS: Record<WorkflowPost['tipo'], string> = {
  feed: 'Feed',
  reels: 'Reels',
  stories: 'Stories',
  carrossel: 'Carrossel',
};

export const STATUS_LABELS: Record<WorkflowPost['status'], string> = {
  rascunho: 'Rascunho',
  revisao_interna: 'Em revisão',
  aprovado_interno: 'Aprovado internamente',
  enviado_cliente: 'Enviado ao cliente',
  aprovado_cliente: 'Aprovado pelo cliente',
  correcao_cliente: 'Correção solicitada',
  agendado: 'Agendado',
  postado: 'Postado',
  falha_publicacao: 'Falha na publicação',
};

export const STATUS_CLASS: Record<WorkflowPost['status'], string> = {
  rascunho: 'post-status--rascunho',
  revisao_interna: 'post-status--revisao',
  aprovado_interno: 'post-status--aprovado-interno',
  enviado_cliente: 'post-status--enviado',
  aprovado_cliente: 'post-status--aprovado-cliente',
  correcao_cliente: 'post-status--correcao',
  agendado: 'post-status--agendado',
  postado: 'post-status--postado',
  falha_publicacao: 'status-danger',
};
