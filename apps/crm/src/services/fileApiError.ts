/** Erro de edge function de arquivos com o corpo JSON preservado (o 409
 * file_in_use carrega linked_posts/linked_reports). message = body.error, então
 * quem testa `message.includes('file_in_use')` continua funcionando. */
export class FileApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'FileApiError';
  }
}
