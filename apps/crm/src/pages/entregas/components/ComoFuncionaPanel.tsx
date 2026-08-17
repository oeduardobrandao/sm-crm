import { ChevronRight, X, Zap, Hand, Eye, EyeOff } from 'lucide-react';
import { STATUS_LABELS, VISIBILITY_TEXT_LABEL } from '../postLabels';

export const explainerStorageKey = (contaId: string) => `entregas_explainer_dismissed_${contaId}`;

/**
 * The always-reachable "Como funciona" panel.
 *
 * The guided tour only auto-starts on an empty board and only 8% of users ever
 * saw it, so the page's model — three nested objects, two independent progress
 * tracks, and a pile of automatic transitions — was effectively undocumented
 * for everyone else. This states it in place, stays dismissed per conta, and
 * comes back from the header button.
 *
 * Every claim here is drawn from live behaviour, not aspiration: the etapa/post
 * split is `workflows.etapa_atual` vs `workflow_posts.status`; the re-arm is
 * `completeEtapaWithRearm`; template propagation is
 * `propagateTemplateToWorkflows`, which only rewrites `pendente` etapas.
 */
export function ComoFuncionaPanel({ onDismiss }: { onDismiss: () => void }) {
  return (
    <section className="entregas-explainer" aria-labelledby="entregas-explainer-title">
      <div className="entregas-explainer-head">
        <h2 id="entregas-explainer-title">Como funciona esta página</h2>
        <button
          type="button"
          className="entregas-explainer-close"
          onClick={onDismiss}
          aria-label="Fechar explicação"
          title="Fechar — você pode reabrir em “Como funciona”"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="entregas-explainer-grid">
        <div className="entregas-explainer-block">
          <h3>Os objetos</h3>
          <p className="entregas-explainer-chain">
            <strong>Fluxo</strong>
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            <strong>Etapas</strong>
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            <strong>Posts</strong>
          </p>
          <dl>
            <dt>Fluxo</dt>
            <dd>
              Um ciclo de entrega de um cliente (ex.: “Posts de março”). É o card do kanban, na aba{' '}
              <em>Fluxos</em>.
            </dd>
            <dt>Etapa</dt>
            <dd>
              As fases dentro do fluxo — Criação, Revisão, Aprovação, Agendamento. Só uma fica ativa
              por vez, e é ela que define o prazo do card.
            </dd>
            <dt>Post</dt>
            <dd>
              O conteúdo em si. Vive dentro de um fluxo e tem o seu próprio status, na aba{' '}
              <em>Publicações</em>.
            </dd>
            <dt>Modelo</dt>
            <dd>
              O esqueleto reutilizável de um fluxo. Editar um modelo reescreve as etapas ainda{' '}
              <strong>não iniciadas</strong> dos fluxos ativos que o usam — as que já começaram
              ficam como estão.
            </dd>
          </dl>
        </div>

        <div className="entregas-explainer-block">
          <h3>São dois trilhos separados</h3>
          <p>
            O fluxo anda por <strong>etapa</strong>. O post anda por <strong>status</strong>. Os
            dois <strong>não se sincronizam</strong>: avançar a etapa não mexe no status dos posts,
            e mudar o status de um post não avança a etapa.
          </p>
          <p>
            Um fluxo pode estar na etapa “Agendamento” com todos os posts ainda em Rascunho — nada
            impede, então vale conferir os dois antes de concluir um ciclo.
          </p>
          <p className="entregas-explainer-note">
            A exceção: ao concluir uma etapa de aprovação quando existe outra aprovação mais
            adiante, os posts já aprovados voltam para Rascunho para o próximo ciclo.
          </p>
        </div>

        <div className="entregas-explainer-block">
          <h3>O que acontece sozinho</h3>
          <div className="entregas-explainer-cols">
            <div>
              <h4>
                <Zap className="h-3.5 w-3.5" aria-hidden="true" /> Automático
              </h4>
              <ul>
                <li>Post agendado publica na data marcada</li>
                <li>Status vira “Postado” ou “Falha” após a publicação</li>
                <li>Falha é tentada de novo até 3 vezes</li>
                <li>Aprovação e correção do cliente chegam do portal</li>
                <li>Fluxo recorrente gera o próximo ciclo ao concluir</li>
                <li>Prazos são recalculados a partir da data de entrega do cliente</li>
              </ul>
            </div>
            <div>
              <h4>
                <Hand className="h-3.5 w-3.5" aria-hidden="true" /> Você faz
              </h4>
              <ul>
                <li>Avançar ou voltar a etapa do fluxo</li>
                <li>Criar posts e escrever o conteúdo</li>
                <li>Enviar ao cliente</li>
                <li>Agendar a publicação</li>
                <li>Concluir ou arquivar o fluxo</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="entregas-explainer-block">
          <h3>Quem vê o quê</h3>
          <p>
            O status do post decide sozinho se o cliente enxerga o post no portal. A partir de{' '}
            <strong>“{STATUS_LABELS.enviado_cliente}”</strong> ele fica visível — e continua visível
            em todos os status seguintes.
          </p>
          <ul className="entregas-explainer-visibility">
            <li>
              <span className="entregas-explainer-vis-icon">
                <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <span>
                <strong>{VISIBILITY_TEXT_LABEL.internal}</strong> — {STATUS_LABELS.rascunho},{' '}
                {STATUS_LABELS.revisao_interna}, {STATUS_LABELS.aprovado_interno}
              </span>
            </li>
            <li>
              <span className="entregas-explainer-vis-icon is-visible">
                <Eye className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <span>
                <strong>{VISIBILITY_TEXT_LABEL.visible}</strong> — de{' '}
                {STATUS_LABELS.enviado_cliente} em diante, incluindo{' '}
                {STATUS_LABELS.falha_publicacao}
              </span>
            </li>
          </ul>
          <p className="entregas-explainer-note">
            O ícone aparece em cada post do fluxo, e cada status no seletor diz qual dos dois é.
          </p>
        </div>
      </div>
    </section>
  );
}
