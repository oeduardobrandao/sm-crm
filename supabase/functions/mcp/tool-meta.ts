// Título (pt-BR) e anotações MCP de cada ferramenta do workspace. O `register` exige uma entrada
// por ferramenta: uma ferramenta nova sem entrada aqui falha no registro, não em produção.
// `destructive` marca remoções e ações que congelam ou descongelam o estado (fechar/reabrir
// período, encerrar modelo recorrente); nenhuma ferramenta fala com o mundo fora do Mesaas
// (`openWorld` fica falso para todas).
export type ToolMeta = { title: string; readOnly: boolean; destructive?: boolean; openWorld?: boolean };

export const TOOL_META: Record<string, ToolMeta> = {
  // ---- tools.ts ----
  list_clients: { title: "Listar clientes", readOnly: true },
  get_client: { title: "Ver cliente", readOnly: true },
  get_brand_profile: { title: "Ver perfil de marca", readOnly: true },
  list_posts: { title: "Listar posts", readOnly: true },
  get_post: { title: "Ver post", readOnly: true },
  get_performance_baseline: { title: "Ver desempenho de referência", readOnly: true },
  list_workflows: { title: "Listar fluxos", readOnly: true },
  list_ideas: { title: "Listar ideias", readOnly: true },
  list_post_feedback: { title: "Listar feedback de posts", readOnly: true },
  list_pages: { title: "Listar páginas", readOnly: true },
  list_workflow_templates: { title: "Listar modelos de fluxo", readOnly: true },
  create_workflow: { title: "Criar fluxo", readOnly: false },
  create_post: { title: "Criar post em rascunho", readOnly: false },
  update_post: { title: "Editar post", readOnly: false },
  set_post_property: { title: "Definir propriedade do post", readOnly: false },
  create_workflow_template: { title: "Criar modelo de fluxo", readOnly: false },
  create_media_upload: { title: "Preparar envio de mídia", readOnly: false },
  set_post_media: { title: "Anexar mídia ao post", readOnly: false },
  list_tasks: { title: "Listar tarefas", readOnly: true },
  create_task: { title: "Criar tarefa", readOnly: false },
  update_task: { title: "Editar tarefa", readOnly: false },
  create_client: { title: "Criar cliente", readOnly: false },
  list_members: { title: "Listar membros", readOnly: true },
  create_member: { title: "Criar membro", readOnly: false },
  // ---- financeiro-tools.ts ----
  list_lancamentos: { title: "Listar lançamentos", readOnly: true },
  list_recorrentes: { title: "Listar recorrentes", readOnly: true },
  get_cobrancas: { title: "Ver cobranças", readOnly: true },
  get_financeiro_v2: { title: "Ver Financeiro v2", readOnly: true },
  get_rentabilidade: { title: "Ver rentabilidade", readOnly: true },
  get_cliente_versoes: { title: "Ver versões de cobrança do cliente", readOnly: true },
  get_acordo_versoes: { title: "Ver versões do acordo", readOnly: true },
  create_lancamento: { title: "Criar lançamento", readOnly: false },
  update_lancamento: { title: "Editar lançamento", readOnly: false },
  delete_lancamento: { title: "Excluir lançamento", readOnly: false, destructive: true },
  confirmar_agendamento: { title: "Confirmar lançamento agendado", readOnly: false },
  create_recorrente: { title: "Criar recorrente", readOnly: false },
  update_recorrente: { title: "Editar recorrente", readOnly: false },
  // Remove o modelo quando ele começou neste mês ou depois, então conta como destrutiva.
  encerrar_recorrente: { title: "Encerrar recorrente", readOnly: false, destructive: true },
  set_cobranca_cliente: { title: "Definir cobrança do cliente", readOnly: false },
  set_custo_membro: { title: "Definir custo do membro", readOnly: false },
  seed_financeiro_v2: { title: "Configurar Financeiro v2", readOnly: false },
  save_financeiro_config: { title: "Salvar configuração do Financeiro", readOnly: false },
  save_funcao: { title: "Salvar função da equipe", readOnly: false },
  delete_funcao: { title: "Excluir função da equipe", readOnly: false, destructive: true },
  save_acordo: { title: "Salvar acordo do membro", readOnly: false },
  save_atribuicoes: { title: "Salvar atribuições", readOnly: false },
  save_entregas: { title: "Registrar entregas", readOnly: false },
  fechar_periodo: { title: "Fechar período", readOnly: false, destructive: true },
  // Reabre um período congelado e invalida o fechamento: mexe no mesmo estado que fechar.
  reabrir_periodo: { title: "Reabrir período", readOnly: false, destructive: true },
};
