import { Trans, useTranslation } from 'react-i18next';
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
 * split is `workflows.etapa_atual` vs `workflow_posts.status`; leaving an
 * approval etapa never changes post statuses on its own, the user picks what
 * happens in `ApprovalExitDialog`; template propagation is `saveWorkflowTemplate`
 * (`update_workflow_template`), which matches fluxo etapas to the template by
 * name and updates `pendente` and `ativo` etapas field by field, only where the
 * fluxo still holds the template's previous value (never `concluido`, and never
 * the `status`/`iniciado_em`/`concluido_em` of an existing etapa).
 */
export function ComoFuncionaPanel({
  onDismiss,
  postProcessesEnabled = false,
  embedded = false,
}: {
  onDismiss: () => void;
  postProcessesEnabled?: boolean;
  /** Inside a phone sheet: the sheet carries the title and the close button. */
  embedded?: boolean;
}) {
  const { t } = useTranslation('entregas');
  return (
    <section
      className={embedded ? 'ex-panel ex-panel--embedded' : 'ex-panel'}
      aria-labelledby={embedded ? undefined : 'entregas-explainer-title'}
    >
      {!embedded && (
        <div className="ex-head">
          <h2 id="entregas-explainer-title">{t('comoFunciona.title')}</h2>
          <button
            type="button"
            className="ex-close"
            onClick={onDismiss}
            aria-label={t('comoFunciona.closeAria')}
            title={t('comoFunciona.closeTitle')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="ex-grid">
        {/* ── Os objetos ─ containment shown by indentation, not described in prose */}
        <article className="ex-card">
          <h3>
            <Boxes className="h-4 w-4" aria-hidden="true" />
            {t('comoFunciona.objects.title')}
          </h3>

          <ol className="ex-tree">
            <li className="ex-tree-l0">
              <span className="ex-term">{t('comoFunciona.objects.fluxo')}</span>
              <span className="ex-def">
                {postProcessesEnabled
                  ? t('comoFunciona.objects.fluxoDefProcesses')
                  : t('comoFunciona.objects.fluxoDef')}
              </span>
            </li>
            <li className="ex-tree-l1">
              <span className="ex-term">{t('comoFunciona.objects.etapas')}</span>
              <span className="ex-def">
                {postProcessesEnabled
                  ? t('comoFunciona.objects.etapasDefProcesses')
                  : t('comoFunciona.objects.etapasDef')}
              </span>
            </li>
            <li className="ex-tree-l2">
              <span className="ex-term">{t('comoFunciona.objects.posts')}</span>
              <span className="ex-def">{t('comoFunciona.objects.postsDef')}</span>
            </li>
            {postProcessesEnabled && (
              <li className="ex-tree-l0">
                <span className="ex-term">{t('comoFunciona.objects.individual')}</span>
                <span className="ex-def">{t('comoFunciona.objects.individualDef')}</span>
              </li>
            )}
          </ol>

          <p className="ex-aside">
            <Trans
              t={t}
              i18nKey="comoFunciona.objects.modelo"
              components={{ term: <span className="ex-term" />, b: <strong /> }}
            />
          </p>
        </article>

        {/* ── Dois trilhos ─ the single most misunderstood rule on the page */}
        <article className="ex-card">
          <h3>
            <Route className="h-4 w-4" aria-hidden="true" />
            {t('comoFunciona.tracks.title')}
          </h3>

          <div className="ex-tracks">
            <div className="ex-track">
              <span className="ex-track-obj">{t('comoFunciona.objects.fluxo')}</span>
              <span className="ex-track-verb">{t('comoFunciona.tracks.movesBy')}</span>
              <span className="ex-chip ex-chip--etapa">{t('comoFunciona.tracks.etapa')}</span>
            </div>
            <div className="ex-track">
              <span className="ex-track-obj">{t('comoFunciona.tracks.post')}</span>
              <span className="ex-track-verb">{t('comoFunciona.tracks.movesBy')}</span>
              <span className="ex-chip ex-chip--status">{t('comoFunciona.tracks.status')}</span>
            </div>
          </div>

          <p className="ex-punch">{t('comoFunciona.tracks.punch')}</p>
          <p className="ex-body">{t('comoFunciona.tracks.body')}</p>
          <p className="ex-aside">
            <Trans t={t} i18nKey="comoFunciona.tracks.exception" components={{ b: <strong /> }} />
          </p>
          <p className="ex-aside">
            {postProcessesEnabled
              ? t('comoFunciona.tracks.noFluxoProcesses')
              : t('comoFunciona.tracks.noFluxo')}
          </p>
        </article>

        {/* ── Automático vs manual ─ two columns, colour-coded */}
        <article className="ex-card">
          <h3>
            <Layers className="h-4 w-4" aria-hidden="true" />
            {t('comoFunciona.auto.title')}
          </h3>

          <div className="ex-split">
            <div className="ex-split-col ex-split-col--auto">
              <h4>
                <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                {t('comoFunciona.auto.autoTitle')}
              </h4>
              <ul>
                <li>{t('comoFunciona.auto.a1')}</li>
                <li>{t('comoFunciona.auto.a2')}</li>
                <li>{t('comoFunciona.auto.a3')}</li>
                <li>{t('comoFunciona.auto.a4')}</li>
                <li>{t('comoFunciona.auto.a5')}</li>
                <li>{t('comoFunciona.auto.a6')}</li>
              </ul>
            </div>
            <div className="ex-split-col ex-split-col--manual">
              <h4>
                <Hand className="h-3.5 w-3.5" aria-hidden="true" />
                {t('comoFunciona.auto.manualTitle')}
              </h4>
              <ul>
                <li>{t('comoFunciona.auto.m1')}</li>
                <li>{t('comoFunciona.auto.m2')}</li>
                <li>{t('comoFunciona.auto.m3')}</li>
                <li>{t('comoFunciona.auto.m4')}</li>
                <li>{t('comoFunciona.auto.m5')}</li>
              </ul>
            </div>
          </div>
        </article>

        {/* ── Quem vê o quê ─ the rule the status column decides silently */}
        <article className="ex-card">
          <h3>
            <Eye className="h-4 w-4" aria-hidden="true" />
            {t('comoFunciona.visibility.title')}
          </h3>

          <p className="ex-body">{t('comoFunciona.visibility.body')}</p>

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
                  {t('comoFunciona.visibility.fromOn', { status: STATUS_LABELS.enviado_cliente })}
                </span>
              </span>
            </li>
          </ul>

          <p className="ex-aside">{t('comoFunciona.visibility.aside')}</p>
        </article>
      </div>
    </section>
  );
}
