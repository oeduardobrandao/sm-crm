/** Rótulos do status de uma ideia. Fora do IdeiasPage para a busca global
 *  usar sem puxar a página (lazy) para o bundle do layout. */
export const IDEIA_STATUS_LABELS: Record<string, string> = {
  nova: 'Nova',
  em_analise: 'Em análise',
  aprovada: 'Aprovada',
  descartada: 'Descartada',
  convertida: 'Virou tarefa',
  concluida: 'Concluída',
};
