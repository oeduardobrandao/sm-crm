import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { LinhaItem } from '@/store/linhaEditorial';
import type { Cliente } from '../../../../store';
import { FormatoPill } from '../../linha/FormatoPill';
import { countApprovals, postsLabel } from '../wizardLogic';
import { resolveDeliveryDate } from '../createWorkflow';
import type { WizardSeed, WizardState } from '../NewWorkflowWizard';

type ModoPrazo = WizardState['modoPrazo'];

const MODO_LABEL: Record<ModoPrazo, string> = {
  padrao: 'Duração por etapa',
  data_fixa: 'Datas fixas',
  data_entrega: 'Data de entrega do cliente',
};

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
  const n = seed.itens.length;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      <p id="wizard-seed-posts" style={{ margin: 0, fontSize: '0.8rem', fontWeight: 600 }}>
        {`${postsLabel(n)} ${n === 1 ? 'vindo' : 'vindos'} da ${seed.origemLabel}, ${
          n === 1 ? 'já preenchido' : 'já preenchidos'
        }`}
      </p>
      <ul
        aria-label="Posts da linha editorial"
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
                    {format(d, 'EEE', { locale: ptBR })}
                  </>
                ) : (
                  'Sem data'
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
                  {item.titulo.trim() || 'Sem título'}
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
        Os prazos seguem as etapas do fluxo.
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
  const etapas = state.etapas.filter((e) => e.nome.trim());
  const aprovacoes = countApprovals(etapas);

  let prazosValor = MODO_LABEL[modoPrazo];
  if (modoPrazo === 'data_entrega' && cliente?.dia_entrega) {
    const entrega = resolveDeliveryDate(state.mesEntrega, cliente.dia_entrega);
    prazosValor += ` · entrega em ${entrega.toLocaleDateString('pt-BR')}`;
  }

  // Vindo de um template, o padrão NÃO pode ser o nome do próprio template: a
  // caixa cria um modelo novo, nunca atualiza o de origem, e sugerir o mesmo
  // nome produzia um duplicado homônimo — que no quadro vira uma segunda aba
  // indistinguível do original. Sufixo explícito para que o nome já diga que é
  // outro modelo.
  const sourceTemplateNome = state.source?.kind === 'template' ? state.source.templateNome : null;
  const defaultTemplateName =
    state.source?.kind === 'preset'
      ? `${state.source.presetNome} — ${cliente?.nome ?? ''}`.trim()
      : sourceTemplateNome
        ? `${sourceTemplateNome} (cópia)`
        : state.nome;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <h3 style={{ margin: 0 }}>Revisar e criar</h3>

      <div>
        <Row label="Cliente" value={cliente?.nome ?? '—'} />
        <Row label="Nome" value={state.nome} />
        {/* The row's label already says "Etapas", so the value is just the count. */}
        <Row
          label="Etapas"
          value={
            aprovacoes > 0
              ? `${etapas.length} (${aprovacoes} ${
                  aprovacoes === 1 ? 'aprovação do cliente' : 'aprovações do cliente'
                })`
              : String(etapas.length)
          }
        />
        <Row label="Prazos" value={prazosValor} />
        <Row label="Recorrente" value={state.recorrente ? 'Sim' : 'Não'} />
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
          <b>Salvar estas etapas como um modelo novo</b>
          <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            {sourceTemplateNome
              ? `Cria um modelo separado. O modelo "${sourceTemplateNome}" não é alterado: para mudar o original, use Gerenciar Templates no quadro de Fluxos.`
              : 'A receita fica disponível no passo 1 para os próximos fluxos.'}
          </span>
        </span>
      </label>

      {state.saveAsTemplate && (
        <div className="space-y-1">
          <Label htmlFor="wizard-template-nome">Nome do modelo</Label>
          <Input
            id="wizard-template-nome"
            value={state.templateName}
            onChange={(e) => patch({ templateName: e.target.value })}
          />
          {/* A blank name makes the creation path skip the template silently, so say so rather
              than dropping the request without a word. */}
          {!state.templateName.trim() && (
            <p role="alert" style={{ fontSize: '0.7rem', color: 'var(--danger)', margin: 0 }}>
              Dê um nome ao modelo: sem nome, o fluxo é criado mas o modelo não é salvo.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
