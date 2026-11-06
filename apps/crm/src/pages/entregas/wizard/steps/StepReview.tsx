import { format, parseISO } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { useDateFnsLocale, useIntlLocale } from '@mesaas/i18n';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { LinhaItem } from '@/store/linhaEditorial';
import type { Cliente } from '../../../../store';
import { FormatoPill } from '../../linha/FormatoPill';
import { countApprovals, postsLabel } from '../wizardLogic';
import { resolveDeliveryDate } from '../createWorkflow';
import type { WizardSeed, WizardState } from '../NewWorkflowWizard';

type ModoPrazo = WizardState['modoPrazo'];

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: '1rem',
        padding: '0.5rem 0',
        borderBottom: '1px solid var(--border-color)',
      }}
    >
      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontSize: '0.8rem', fontWeight: 600, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

/** Date order (the order the fluxo gets), undated rows last. */
function porData(itens: LinhaItem[]): LinhaItem[] {
  return [...itens].sort((a, b) => {
    if (a.data !== b.data) {
      if (a.data == null) return 1;
      if (b.data == null) return -1;
      return a.data < b.data ? -1 : 1;
    }
    return a.ordem - b.ordem;
  });
}

/** The posts a linha editorial seed will create. Deadlines stay per etapa, so none show here. */
function SeedPosts({ seed }: { seed: WizardSeed }) {
  const { t } = useTranslation('workflows');
  const dateLocale = useDateFnsLocale();
  const n = seed.itens.length;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      <p id="wizard-seed-posts" style={{ margin: 0, fontSize: '0.8rem', fontWeight: 600 }}>
        {t('wizard.seedPosts', { count: n, posts: postsLabel(n), origem: seed.origemLabel })}
      </p>
      <ul
        aria-label={t('wizard.seedPostsAria')}
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          maxHeight: 240,
          overflowY: 'auto',
          border: '1px solid var(--border-color)',
          borderRadius: 10,
        }}
      >
        {porData(seed.itens).map((item, i) => {
          const d = item.data ? parseISO(item.data) : null;
          const direcao =
            item.direcao
              .split('\n')
              .find((l) => l.trim())
              ?.trim() ?? '';
          return (
            <li
              key={item.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.5rem 0.75rem',
                borderTop: i === 0 ? 'none' : '1px solid var(--border-color)',
              }}
            >
              <span
                style={{
                  flexShrink: 0,
                  width: 64,
                  fontSize: '0.72rem',
                  color: 'var(--text-muted)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {d ? (
                  <>
                    <span style={{ display: 'block', fontWeight: 600, color: 'var(--text-main)' }}>
                      {format(d, 'dd/MM')}
                    </span>
                    {format(d, 'EEE', { locale: dateLocale })}
                  </>
                ) : (
                  t('wizard.noDate')
                )}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    display: 'block',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.titulo.trim() || t('wizard.untitled')}
                </span>
                {direcao && (
                  <span
                    style={{
                      display: 'block',
                      fontSize: '0.72rem',
                      color: 'var(--text-muted)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {direcao}
                  </span>
                )}
              </span>
              <FormatoPill tipo={item.tipo} />
            </li>
          );
        })}
      </ul>
      <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-muted)' }}>
        {t('wizard.seedDeadlinesHint')}
      </p>
    </div>
  );
}

export function StepReview({
  state,
  patch,
  modoPrazo,
  cliente,
  seed,
}: {
  state: WizardState;
  patch: (p: Partial<WizardState>) => void;
  /** The EFFECTIVE mode — the shell falls back to `padrao` when data_entrega is unavailable. */
  modoPrazo: ModoPrazo;
  cliente: Cliente | undefined;
  /** Linha editorial rows this fluxo will carry as posts. */
  seed?: WizardSeed;
}) {
  // Blank rows are dropped at creation, so the summary counts only what will actually be saved.
  const { t } = useTranslation('workflows');
  const intlLocale = useIntlLocale();
  const etapas = state.etapas.filter((e) => e.nome.trim());
  const aprovacoes = countApprovals(etapas);

  let prazosValor = t(`wizard.modes.${modoPrazo}`);
  if (modoPrazo === 'data_entrega' && cliente?.dia_entrega) {
    const entrega = resolveDeliveryDate(state.mesEntrega, cliente.dia_entrega);
    prazosValor = t('wizard.deliveryOn', {
      mode: prazosValor,
      date: entrega.toLocaleDateString(intlLocale),
    });
  }

  // Vindo de um template, o padrão NÃO pode ser o nome do próprio template: a
  // caixa cria um modelo novo, nunca atualiza o de origem, e sugerir o mesmo
  // nome produzia um duplicado homônimo — que no quadro vira uma segunda aba
  // indistinguível do original. Sufixo explícito para que o nome já diga que é
  // outro modelo.
  const sourceTemplateNome = state.source?.kind === 'template' ? state.source.templateNome : null;
  const defaultTemplateName =
    state.source?.kind === 'preset'
      ? t('wizard.presetTemplateName', {
          preset: state.source.presetNome,
          client: cliente?.nome ?? '',
        }).trim()
      : sourceTemplateNome
        ? t('wizard.copySuffix', { name: sourceTemplateNome })
        : state.nome;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <h3 style={{ margin: 0 }}>{t('wizard.reviewTitle')}</h3>

      <div>
        <Row label={t('wizard.rowClient')} value={cliente?.nome ?? '—'} />
        <Row label={t('wizard.rowName')} value={state.nome} />
        {/* The row's label already says "Etapas", so the value is just the count. */}
        <Row
          label={t('wizard.rowStages')}
          value={
            aprovacoes > 0
              ? t('wizard.stagesWithApprovals', { count: aprovacoes, total: etapas.length })
              : String(etapas.length)
          }
        />
        <Row label={t('wizard.rowDeadlines')} value={prazosValor} />
        <Row
          label={t('wizard.rowRecurring')}
          value={state.recorrente ? t('actions.yes') : t('actions.no')}
        />
      </div>

      {seed && <SeedPosts seed={seed} />}

      <label
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'flex-start',
          background: 'rgba(234,179,8,0.08)',
          border: '1px solid rgba(234,179,8,0.35)',
          borderRadius: 10,
          padding: '0.7rem 0.9rem',
        }}
      >
        <input
          type="checkbox"
          checked={state.saveAsTemplate}
          onChange={(e) =>
            patch({
              saveAsTemplate: e.target.checked,
              templateName: state.templateName || defaultTemplateName,
            })
          }
        />
        <span>
          <b>{t('wizard.saveAsTemplate')}</b>
          <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            {sourceTemplateNome
              ? t('wizard.saveAsTemplateFromTemplate', { name: sourceTemplateNome })
              : t('wizard.saveAsTemplateHint')}
          </span>
        </span>
      </label>

      {state.saveAsTemplate && (
        <div className="space-y-1">
          <Label htmlFor="wizard-template-nome">{t('wizard.templateName')}</Label>
          <Input
            id="wizard-template-nome"
            value={state.templateName}
            onChange={(e) => patch({ templateName: e.target.value })}
          />
          {/* A blank name makes the creation path skip the template silently, so say so rather
              than dropping the request without a word. */}
          {!state.templateName.trim() && (
            <p role="alert" style={{ fontSize: '0.7rem', color: 'var(--danger)', margin: 0 }}>
              {t('wizard.templateNameRequired')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
