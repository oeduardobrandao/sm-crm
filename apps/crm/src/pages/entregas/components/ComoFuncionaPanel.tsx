import { Boxes, Eye, EyeOff, Hand, Layers, Route, X, Zap } from 'lucide-react';
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
 * Built to be *scanned*, not read: every claim that can be a labelled row, a
 * nesting rule or a two-column split is one, and the prose that survives is
 * only the part that genuinely needs a sentence. The first draft was four
 * paragraph blocks and read as a wall of text.
 *
 * Every claim is drawn from live behaviour, not aspiration: the etapa/post
 * split is `workflows.etapa_atual` vs `workflow_posts.status`; the re-arm is
 * `completeEtapaWithRearm`; template propagation is
 * `propagateTemplateToWorkflows`, which rewrites `pendente` and `ativo` etapas
 * (never `concluido`, and never `status`/`iniciado_em`/`concluido_em`).
 */
export function ComoFuncionaPanel({ onDismiss }: { onDismiss: () => void }) {
  return (
    <section className="ex-panel" aria-labelledby="entregas-explainer-title">
      <div className="ex-head">
        <h2 id="entregas-explainer-title">Como funciona esta página</h2>
        <button
          type="button"
          className="ex-close"
          onClick={onDismiss}
          aria-label="Fechar explicação"
          title="Fechar — você pode reabrir em “Como funciona”"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="ex-grid">
        {/* ── Os objetos ─ containment shown by indentation, not described in prose */}
        <article className="ex-card">
          <h3>
            <Boxes className="h-4 w-4" aria-hidden="true" />
            Os objetos
          </h3>

          <ol className="ex-tree">
            <li className="ex-tree-l0">
              <span className="ex-term">Fluxo</span>
              <span className="ex-def">um ciclo de entrega de um cliente — o card do kanban</span>
            </li>
            <li className="ex-tree-l1">
              <span className="ex-term">Etapas</span>
              <span className="ex-def">as fases do fluxo — só uma fica ativa por vez</span>
            </li>
            <li className="ex-tree-l2">
              <span className="ex-term">Posts</span>
              <span className="ex-def">o conteúdo em si, cada um com o seu status</span>
            </li>
          </ol>

          <p className="ex-aside">
            <span className="ex-term">Modelo</span> é o esqueleto reutilizável de um fluxo. Editá-lo
            reescreve só as etapas <strong>ainda não iniciadas</strong> dos fluxos que o usam.
          </p>
        </article>

        {/* ── Dois trilhos ─ the single most misunderstood rule on the page */}
        <article className="ex-card">
          <h3>
            <Route className="h-4 w-4" aria-hidden="true" />
            São dois trilhos separados
          </h3>

          <div className="ex-tracks">
            <div className="ex-track">
              <span className="ex-track-obj">Fluxo</span>
              <span className="ex-track-verb">anda por</span>
              <span className="ex-chip ex-chip--etapa">etapa</span>
            </div>
            <div className="ex-track">
              <span className="ex-track-obj">Post</span>
              <span className="ex-track-verb">anda por</span>
              <span className="ex-chip ex-chip--status">status</span>
            </div>
          </div>

          <p className="ex-punch">Os dois não se sincronizam.</p>
          <p className="ex-body">
            Avançar a etapa não mexe no status dos posts, e mudar o status de um post não avança a
            etapa — um fluxo pode estar em “Agendamento” com tudo ainda em Rascunho.
          </p>
          <p className="ex-aside">
            <strong>Exceção:</strong> concluir uma etapa de aprovação quando existe outra mais
            adiante devolve os posts aprovados para Rascunho.
          </p>
          <p className="ex-aside">
            Um post também pode existir sem fluxo (publicação avulsa): ele anda só pelo trilho de
            status, no quadro de Publicações.
          </p>
        </article>

        {/* ── Automático vs manual ─ two columns, colour-coded */}
        <article className="ex-card">
          <h3>
            <Layers className="h-4 w-4" aria-hidden="true" />O que acontece sozinho
          </h3>

          <div className="ex-split">
            <div className="ex-split-col ex-split-col--auto">
              <h4>
                <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                Automático
              </h4>
              <ul>
                <li>Post agendado publica na data</li>
                <li>Status vira “Postado” ou “Falha”</li>
                <li>Falha é tentada de novo até 3×</li>
                <li>Aprovação do cliente chega do portal</li>
                <li>Fluxo recorrente gera o próximo ciclo</li>
                <li>Prazos seguem a data de entrega</li>
              </ul>
            </div>
            <div className="ex-split-col ex-split-col--manual">
              <h4>
                <Hand className="h-3.5 w-3.5" aria-hidden="true" />
                Você faz
              </h4>
              <ul>
                <li>Avançar ou voltar a etapa</li>
                <li>Criar posts e escrever</li>
                <li>Enviar ao cliente</li>
                <li>Agendar a publicação</li>
                <li>Concluir ou arquivar o fluxo</li>
              </ul>
            </div>
          </div>
        </article>

        {/* ── Quem vê o quê ─ the rule the status column decides silently */}
        <article className="ex-card">
          <h3>
            <Eye className="h-4 w-4" aria-hidden="true" />
            Quem vê o quê
          </h3>

          <p className="ex-body">O status decide sozinho se o cliente enxerga o post no portal.</p>

          <ul className="ex-vis">
            <li>
              <span className="ex-vis-icon">
                <EyeOff className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="ex-vis-text">
                <strong>{VISIBILITY_TEXT_LABEL.internal}</strong>
                <span className="ex-vis-list">
                  {STATUS_LABELS.rascunho} · {STATUS_LABELS.revisao_interna} ·{' '}
                  {STATUS_LABELS.aprovado_interno}
                </span>
              </span>
            </li>
            <li className="is-visible">
              <span className="ex-vis-icon">
                <Eye className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="ex-vis-text">
                <strong>{VISIBILITY_TEXT_LABEL.visible}</strong>
                <span className="ex-vis-list">
                  de {STATUS_LABELS.enviado_cliente} em diante — e não volta atrás
                </span>
              </span>
            </li>
          </ul>

          <p className="ex-aside">
            O olho aparece em cada post, e cada status no seletor diz qual dos dois é.
          </p>
        </article>
      </div>
    </section>
  );
}
