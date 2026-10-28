import { i18n } from '@mesaas/i18n';

/** Rótulos do status de uma ideia. Fora do IdeiasPage para a busca global
 *  usar sem puxar a página (lazy) para o bundle do layout. Cada valor é um
 *  getter que traduz na leitura, então o idioma atual vale sem editar quem importa. */
export const IDEIA_STATUS_LABELS: Record<string, string> = {
  get nova() {
    return i18n.t('ideas:status.nova');
  },
  get em_analise() {
    return i18n.t('ideas:status.em_analise');
  },
  get aprovada() {
    return i18n.t('ideas:status.aprovada');
  },
  get descartada() {
    return i18n.t('ideas:status.descartada');
  },
  get convertida() {
    return i18n.t('ideas:status.convertida');
  },
  get concluida() {
    return i18n.t('ideas:status.concluida');
  },
};
