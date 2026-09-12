import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Clock, Ban, CircleDot, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import {
  getPostProcessEvents,
  updatePostProcessStep,
  type Membro,
  type PostProcess,
  type PostProcessStep,
} from '../../../store';
import { endOfLocalDay, parseLocalISODate, toLocalISODate } from '@/utils/postDate';
import { getPostProcessErrorToast, isStaleStateError } from '../postProcessErrors';
import { etapaDeadlineDateOf, formatEtapaDeadlineDay } from '../etapaPrazo';
import { computeDeadlineDate } from '../hooks/useEntregasData';
import { forwardLabelFor } from '../postProcessCommands';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { buildPostTimeline } from './postTimeline';
import { PostTimelineList } from './PostTimelinePopover';

/** Sentinel para "sem responsável": Radix `SelectItem` (v2) rejeita
 *  `value=""`, então o `null` do modelo é representado por 'none' na UI
 *  (mesmo padrão de TarefaFormDialog.tsx) e traduzido de volta ao salvar. */
const NO_RESPONSAVEL = 'none';

/** Modo local do editor de prazo de UMA etapa (spec §2): 'dias' é o padrão
 *  para processos `modo_prazo = 'padrao'` -- prazo_dias + tipo_prazo como
 *  controle primário, com a data calculada como texto clicável; 'fixa' é o
 *  editor de data livre de sempre (clicado a partir da data calculada). Não
 *  existe modo para processos não-'padrao': esses continuam só com o input
 *  de data, sem alternância. */
type PrazoStepMode = 'dias' | 'fixa';

/** Teto MUITO abaixo do que o servidor aceita (`apply_post_process` valida
 *  `^[0-9]{1,9}$`) de propósito: `computeDeadlineDate` em modo 'uteis' é um
 *  laço de uma iteração POR DIA, e a data calculada é recomputada a cada
 *  render a partir do rascunho -- 9 dígitos travariam a aba enquanto o
 *  usuário digita. Três dígitos também é o que cabe no input (`w-14`). */
const MAX_PRAZO_DIAS = 999;

const ESTADO_LABEL: Record<PostProcessStep['estado'], string> = {
  pendente: 'Pendente',
  ativo: 'Em andamento',
  concluido: 'Concluída',
  herdado: 'Herdada',
  ignorado: 'Ignorada',
  interrompido: 'Interrompida',
};

const PROCESS_LABEL: Record<PostProcess['estado'], string> = {
  ativo: 'Ativo',
  concluido: 'Concluído',
  encerrado: 'Encerrado',
};

function StepIcon({ estado }: { estado: PostProcessStep['estado'] }) {
  if (estado === 'concluido') return <Check className="h-3 w-3" />;
  if (estado === 'ativo') return <CircleDot className="h-3 w-3" />;
  if (estado === 'interrompido') return <Ban className="h-3 w-3" />;
  if (estado === 'pendente') return <Clock className="h-3 w-3" />;
  return null; // herdado / ignorado: só o círculo neutro
}

function toneFor(estado: PostProcessStep['estado']): string {
  if (estado === 'concluido') return 'approved';
  if (estado === 'interrompido') return 'failed';
  return 'neutral';
}

interface PostProductionSectionProps {
  process: PostProcess;
  postId: number;
  membros: Membro[];
  postStatus: string;
  onAvancar?: () => void;
}

/**
 * Seção de produção do post individual (spec §5.4): origem (template ou
 * fluxo de origem), linha de etapas com responsável e prazo por etapa,
 * estado do processo, nota sobre propriedades e o histórico filtrado ao
 * processo. Não existe stepper reutilizável (SortableEtapaList é
 * formulário); a linha usa o estilo history-timeline do PostTimelinePopover.
 * Sem ações no cabeçalho: Avançar/Voltar/Concluir/Reabrir/Remover/Aplicar/
 * Vincular são comandos aparte (fase 4). Enquanto o processo está 'ativo',
 * as etapas 'pendente'/'ativo' ganham editores inline de responsável e
 * prazo (`update_post_process_step`, Task 10); as demais (concluído,
 * herdada, ignorada, interrompida) e qualquer etapa de um processo não
 * ativo continuam só leitura. Só é montada pelo drawer de post avulso
 * (workflowId nulo) e só busca eventos enquanto está aberta.
 * A seção nasce recolhida (spec §1): o cabeçalho é um botão de disclosure com
 * um resumo de uma linha, e o estado aberto/fechado persiste em
 * `sessionStorage` sob `post-production-open:<postId>`.
 */
export function PostProductionSection({
  process,
  postId,
  membros,
  postStatus,
  onAvancar,
}: PostProductionSectionProps) {
  const qc = useQueryClient();
  const { data: events = [] } = useQuery({
    queryKey: ['post-process-events', String(postId)],
    queryFn: () => getPostProcessEvents([postId]),
  });
  const [draft, setDraft] = useState<
    Record<
      number,
      {
        responsavelId: number | null;
        /** Data local (input type=date) do editor de "data fixa". */
        prazo: string;
        prazoDias: number | null;
        tipoPrazo: 'uteis' | 'corridos';
      }
    >
  >({});
  const [savingOrdem, setSavingOrdem] = useState<number | null>(null);
  // Serialização dos saves. Gravar no blur do campo de dias abriu uma janela
  // que o editor não tinha: o Radix Select abre no POINTERDOWN, que vem antes
  // do blur -- então o dropdown de tipo_prazo já está aberto (e seus itens
  // clicáveis no portal, o `disabled` só atinge o trigger) quando o save do
  // blur começa. O segundo save saía com a `revisao` velha das props e
  // levava um `process_changed` na cara do usuário. `revisaoRef` carrega a
  // revisão que o servidor acabou de devolver e `chainRef` põe os saves em
  // fila, para que o segundo leia a revisão já atualizada pelo primeiro.
  const revisaoRef = useRef(process.revisao);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const pendingRef = useRef(0);
  useEffect(() => {
    revisaoRef.current = process.revisao;
  }, [process.revisao]);
  // Alternância dias/fixa é local à seção (não persiste em sessionStorage):
  // some quando a etapa recarrega com nova revisao, igual ao draft.
  const [stepMode, setStepMode] = useState<Record<number, PrazoStepMode>>({});

  const storageKey = `post-production-open:${postId}`;
  const [open, setOpen] = useState(() => {
    try {
      return sessionStorage.getItem(storageKey) === '1';
    } catch {
      return false;
    }
  });
  const toggleOpen = () => {
    setOpen((prev) => {
      const next = !prev;
      try {
        sessionStorage.setItem(storageKey, next ? '1' : '0');
      } catch {
        // sessionStorage indisponível (modo privado etc.): estado em memória segue funcionando.
      }
      return next;
    });
  };

  // O revisão do processo muda a cada `update_post_process_step` bem-sucedido
  // (e a qualquer outro comando que avance/reabra a etapa); ao refetch, o
  // valor do servidor deve vencer sobre qualquer rascunho local pendente.
  useEffect(() => {
    setDraft({});
    setStepMode({});
  }, [process.revisao]);

  const editable = (step: PostProcessStep) =>
    process.estado === 'ativo' && (step.estado === 'pendente' || step.estado === 'ativo');

  const valueOf = (step: PostProcessStep) =>
    draft[step.ordem] ?? {
      responsavelId: step.responsavel_id,
      prazo: step.prazo_efetivo ? toLocalISODate(new Date(step.prazo_efetivo)) : '',
      prazoDias: step.prazo_dias,
      tipoPrazo: step.tipo_prazo ?? 'uteis',
    };

  /** 'dias' é o padrão para toda etapa de processo `modo_prazo = 'padrao'`
   *  (spec §2); processos não-'padrao' não têm alternância (sempre "fixa",
   *  isto é, o input de data de sempre).
   *
   *  O default PRECISA sair dos dados, não de uma constante: `stepMode` é
   *  zerado a cada `process.revisao` nova, e salvar em modo "fixa" bumpa a
   *  revisão. Com default fixo em 'dias', a etapa voltava ao editor de dias
   *  logo após o refetch -- com o input vazio (o save de "fixa" grava
   *  `prazo_dias = null`), escondendo a data recém-escolhida, e a edição
   *  seguinte de responsável recalculava `prazo_efetivo` a partir de
   *  `prazo_dias = null` e APAGAVA essa data. Uma etapa sem `prazo_dias` mas
   *  com `prazo_efetivo` é exatamente a assinatura de "data fixa". */
  const modeOf = (step: PostProcessStep): PrazoStepMode => {
    if (process.modo_prazo !== 'padrao') return 'fixa';
    return (
      stepMode[step.ordem] ?? (step.prazo_dias == null && step.prazo_efetivo ? 'fixa' : 'dias')
    );
  };

  const setModeOf = (step: PostProcessStep, mode: PrazoStepMode) =>
    setStepMode((m) => ({ ...m, [step.ordem]: mode }));

  /** A data calculada exibida junto dos controles de dias -- null enquanto a
   *  etapa não tem `iniciado_em` (spec §2: "definida ao iniciar a etapa"). */
  const computedDateOf = (
    step: PostProcessStep,
    prazoDias: number | null,
    tipoPrazo: 'uteis' | 'corridos',
  ) =>
    step.iniciado_em && prazoDias != null
      ? computeDeadlineDate(step.iniciado_em, prazoDias, tipoPrazo)
      : null;

  const save = (
    step: PostProcessStep,
    next: {
      responsavelId: number | null;
      prazo: string;
      prazoDias: number | null;
      tipoPrazo: 'uteis' | 'corridos';
    },
    mode: PrazoStepMode,
  ) => {
    setDraft((d) => ({ ...d, [step.ordem]: next }));
    pendingRef.current += 1;
    setSavingOrdem(step.ordem);
    const run = async () => {
      try {
        // 'fixa': setter absoluto de data livre, igual ao comportamento de
        // sempre -- e em processo 'padrao' limpa prazo_dias/tipo_prazo (spec
        // §2, "clicar na data calculada alterna para data fixa"). 'dias': o
        // controle primário é prazo_dias/tipo_prazo e o cliente SEMPRE
        // recalcula prazo_efetivo a partir deles (âncora iniciado_em) e manda
        // os três juntos -- nunca só os dois novos sozinhos, ou a data exibida
        // ficaria presa ao valor antigo (etapaDeadlineDateOf dá precedência a
        // prazo_efetivo sobre prazo_dias/tipo_prazo).
        const isDias = mode === 'dias' && process.modo_prazo === 'padrao';
        const prazoEfetivoIso = isDias
          ? (computedDateOf(step, next.prazoDias, next.tipoPrazo)?.toISOString() ?? null)
          : (() => {
              const day = next.prazo ? parseLocalISODate(next.prazo) : null;
              return day ? endOfLocalDay(day).toISOString() : null;
            })();

        const res = await updatePostProcessStep({
          processId: process.id,
          // Da ref, não das props: um save encadeado atrás de outro precisa da
          // revisão que o servidor acabou de devolver, e as props só chegam
          // depois do refetch.
          expectedRevisao: revisaoRef.current,
          ordem: step.ordem,
          responsavelId: next.responsavelId,
          prazoEfetivo: prazoEfetivoIso,
          // Os quatro campos são setters ABSOLUTOS na RPC de 7 parâmetros:
          // omitir prazo_dias/tipo_prazo não é "não mexer", é gravar NULL (o
          // DEFAULT do parâmetro). Por isso o processo não-'padrao' reenvia os
          // valores atuais da etapa em vez de omitir: em `data_fixa`/
          // `data_entrega` as etapas também nascem com prazo_dias/tipo_prazo do
          // template (apply_post_process), e omiti-los apagaria essas colunas a
          // cada edição de responsável ou data -- que é justamente a mudança de
          // comportamento que a spec §2 proíbe nesses modos.
          ...(isDias
            ? { prazoDias: next.prazoDias, tipoPrazo: next.tipoPrazo }
            : process.modo_prazo === 'padrao'
              ? { prazoDias: null, tipoPrazo: null }
              : { prazoDias: step.prazo_dias, tipoPrazo: step.tipo_prazo }),
        });
        if (typeof res?.revisao === 'number') revisaoRef.current = res.revisao;
        qc.invalidateQueries({ queryKey: ['post-process', postId] });
        qc.invalidateQueries({ queryKey: ['post-processes'] });
        qc.invalidateQueries({ queryKey: ['post-process-events'] });
      } catch (err) {
        setDraft((d) => {
          const { [step.ordem]: _drop, ...rest } = d;
          return rest;
        }); // revert to server value
        toast.error(getPostProcessErrorToast(err, 'Erro ao editar etapa'));
        if (isStaleStateError(err)) qc.invalidateQueries({ queryKey: ['post-process', postId] });
      } finally {
        // Só reabilita quando a FILA esvazia -- com dois saves encadeados,
        // o fim do primeiro não pode liberar os controles.
        pendingRef.current -= 1;
        if (pendingRef.current === 0) setSavingOrdem(null);
      }
    };
    chainRef.current = chainRef.current.then(run, run);
    return chainRef.current;
  };

  const origem = process.origem_descricao
    ? `Desmembrado de ${process.origem_descricao}`
    : process.template_nome
      ? `Template: ${process.template_nome}`
      : 'Processo individual';
  const processEvents = events.filter((e) => e.process_id === process.id);
  const nodes = buildPostTimeline({ created_at: undefined }, [], [], processEvents).filter(
    (n) => n.kind === 'process',
  );

  // Resumo de uma linha exibido quando a seção está recolhida (spec §1):
  // etapa atual · posição/total · prazo curto · responsável. "Atual" é a
  // etapa 'ativo'; sem nenhuma ativa (processo encerrado/concluído, ou etapas
  // só herdadas) cai na primeira pendente e, na falta dela, na última etapa --
  // nunca na primeira, que num processo concluído leria "Copy 1/3 · Concluído".
  const summaryStep =
    process.steps.find((s) => s.estado === 'ativo') ??
    process.steps.find((s) => s.estado === 'pendente') ??
    process.steps[process.steps.length - 1];
  const summaryStepIndex = summaryStep ? process.steps.indexOf(summaryStep) : -1;
  const summaryPrazo = summaryStep ? etapaDeadlineDateOf(summaryStep) : null;
  const summaryResponsavel =
    summaryStep?.responsavel_id != null
      ? membros.find((m) => m.id === summaryStep.responsavel_id)?.nome
      : undefined;
  const summary = summaryStep
    ? [
        summaryStep.nome,
        `${summaryStepIndex + 1}/${process.steps.length}`,
        summaryPrazo ? formatEtapaDeadlineDay(summaryPrazo) : 'Sem prazo',
        summaryResponsavel ?? 'Sem responsável',
      ].join(' · ')
    : '';

  return (
    <section className="post-production" aria-labelledby="post-production-title">
      {/* O `h4` embrulha o botão (padrão disclosure do WAI-ARIA): descendentes
          de `button` são apresentacionais, então um heading DENTRO dele some da
          árvore de acessibilidade -- além de `h4` não ser conteúdo válido de
          `button`. O id fica no span para o rótulo da section continuar só
          "Produção". */}
      <h4 className="post-production-heading">
        <button
          type="button"
          className="post-production-head"
          aria-expanded={open}
          onClick={toggleOpen}
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          <span id="post-production-title" className="post-production-title">
            Produção
          </span>
          <span className={`post-production-state post-production-state--${process.estado}`}>
            {PROCESS_LABEL[process.estado]}
          </span>
        </button>
      </h4>

      {!open && summary && <p className="post-production-summary">{summary}</p>}

      {/* A dica de "cliente aprovou" é um CTA, não corpo: fica visível também
          com a seção recolhida (o corpo enumerado pela spec §1 é origem,
          timeline e histórico). */}
      {process.estado === 'ativo' &&
        postStatus === 'aprovado_cliente' &&
        process.steps.find((s) => s.estado === 'ativo')?.tipo === 'aprovacao_cliente' && (
          <div className="post-production-hint" role="status">
            <span>Cliente aprovou. Avançar etapa?</span>
            {onAvancar && (
              <button type="button" className="sem-processo-link" onClick={onAvancar}>
                {forwardLabelFor(process)}
              </button>
            )}
          </div>
        )}

      {open && (
        <>
          <p className="post-production-origem">{origem}</p>

          <div className="history-timeline">
            {process.steps.map((step, i) => {
              const responsavel =
                step.responsavel_id != null
                  ? membros.find((m) => m.id === step.responsavel_id)
                  : undefined;
              const prazo = etapaDeadlineDateOf(step);
              const tone = toneFor(step.estado);
              const stepEditable = editable(step);
              const v = valueOf(step);
              return (
                <div key={step.id} className="history-step">
                  <div className="history-step-track">
                    <div className={`history-step-icon history-step-icon--${tone}`}>
                      <StepIcon estado={step.estado} />
                    </div>
                    {i < process.steps.length - 1 && (
                      <div className={`history-step-line history-step-line--${tone}`} />
                    )}
                  </div>
                  <div className="history-step-body">
                    <div className="history-step-name">
                      {step.nome}
                      {step.tipo === 'aprovacao_cliente' && (
                        <span className="post-production-tipo"> · Aprovação do cliente</span>
                      )}
                    </div>
                    {stepEditable ? (
                      <>
                        <div className="history-step-detail">
                          <span>{ESTADO_LABEL[step.estado]}</span>
                        </div>
                        <div className="post-production-step-edit">
                          <Select
                            value={
                              v.responsavelId != null ? String(v.responsavelId) : NO_RESPONSAVEL
                            }
                            onValueChange={(val) =>
                              save(
                                step,
                                {
                                  ...v,
                                  responsavelId: val === NO_RESPONSAVEL ? null : Number(val),
                                },
                                modeOf(step),
                              )
                            }
                            disabled={savingOrdem !== null}
                          >
                            <SelectTrigger
                              aria-label={`Responsável da etapa ${step.nome}`}
                              className="h-7 text-xs"
                            >
                              <SelectValue placeholder="Sem responsável" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NO_RESPONSAVEL}>Sem responsável</SelectItem>
                              {membros.map((m) => (
                                <SelectItem key={m.id} value={String(m.id)}>
                                  {m.nome}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>

                          {process.modo_prazo === 'padrao' && modeOf(step) === 'dias' ? (
                            <>
                              {/* Digitar NÃO salva: `save` desabilita o campo
                                  enquanto a RPC roda, então salvar por
                                  caractere engolia o segundo dígito de "15" e
                                  gastava uma revisão (e um evento no
                                  histórico) por tecla. Rascunho local no
                                  onChange, gravação no blur/Enter. */}
                              <input
                                type="number"
                                min={0}
                                max={MAX_PRAZO_DIAS}
                                step={1}
                                aria-label={`Dias da etapa ${step.nome}`}
                                className="h-7 text-xs rounded-md border border-input px-2 w-14"
                                value={v.prazoDias ?? ''}
                                disabled={savingOrdem !== null}
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  // O parâmetro da RPC é `integer`: sem esta
                                  // guarda um "2.5" (type=number aceita) ou um
                                  // valor de 10 dígitos vira erro de cast do
                                  // PostgREST, fora da tabela de mensagens.
                                  const parsed = raw === '' ? null : Number(raw);
                                  if (
                                    parsed !== null &&
                                    !(
                                      Number.isInteger(parsed) &&
                                      parsed >= 0 &&
                                      parsed <= MAX_PRAZO_DIAS
                                    )
                                  )
                                    return;
                                  setDraft((d) => ({
                                    ...d,
                                    [step.ordem]: { ...v, prazoDias: parsed },
                                  }));
                                }}
                                onBlur={() => {
                                  // Sem mudança real, não gasta revisão (o
                                  // usuário só passou pelo campo com Tab).
                                  if (v.prazoDias !== step.prazo_dias) save(step, v, 'dias');
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    e.currentTarget.blur();
                                  }
                                }}
                              />
                              <Select
                                value={v.tipoPrazo}
                                onValueChange={(val) =>
                                  save(
                                    step,
                                    { ...v, tipoPrazo: val as 'uteis' | 'corridos' },
                                    'dias',
                                  )
                                }
                                disabled={savingOrdem !== null}
                              >
                                <SelectTrigger
                                  aria-label={`Tipo de prazo da etapa ${step.nome}`}
                                  className="h-7 text-xs"
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="uteis">Dias úteis</SelectItem>
                                  <SelectItem value="corridos">Dias corridos</SelectItem>
                                </SelectContent>
                              </Select>
                              {(() => {
                                const computed = computedDateOf(step, v.prazoDias, v.tipoPrazo);
                                // Sem data calculada por dois motivos
                                // diferentes: a etapa ainda não começou (não
                                // há âncora) ou está sem dias preenchidos.
                                const label = computed
                                  ? formatEtapaDeadlineDay(computed)
                                  : step.iniciado_em
                                    ? 'sem prazo'
                                    : 'definida ao iniciar a etapa';
                                return (
                                  // Só o texto visível ("20 set") não diz que
                                  // isto é um controle nem o que ele faz. O
                                  // aria-label começa por esse mesmo texto
                                  // (WCAG 2.5.3, label in name) e completa a
                                  // ação para quem usa leitor de tela.
                                  <button
                                    type="button"
                                    className="sem-processo-link"
                                    aria-label={`${label}: usar data fixa na etapa ${step.nome}`}
                                    disabled={savingOrdem !== null}
                                    onClick={() => setModeOf(step, 'fixa')}
                                  >
                                    {label}
                                  </button>
                                );
                              })()}
                            </>
                          ) : (
                            <>
                              <input
                                type="date"
                                aria-label={`Prazo da etapa ${step.nome}`}
                                className="h-7 text-xs rounded-md border border-input px-2"
                                value={v.prazo}
                                disabled={savingOrdem !== null}
                                onChange={(e) =>
                                  save(step, { ...v, prazo: e.target.value }, 'fixa')
                                }
                              />
                              {process.modo_prazo === 'padrao' && (
                                <button
                                  type="button"
                                  className="sem-processo-link"
                                  aria-label={`Usar dias na etapa ${step.nome}`}
                                  disabled={savingOrdem !== null}
                                  onClick={() => setModeOf(step, 'dias')}
                                >
                                  Usar dias
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="history-step-detail">
                        <span>{ESTADO_LABEL[step.estado]}</span>
                        {' · '}
                        <span>{responsavel ? responsavel.nome : 'Sem responsável'}</span>
                        {' · '}
                        <span>{prazo ? formatEtapaDeadlineDay(prazo) : 'Sem prazo'}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {process.template_id != null && (
            <p className="post-production-note">
              Propriedades do template só valem dentro de um fluxo
            </p>
          )}

          {nodes.length > 0 && (
            <div className="post-production-history">
              <div className="post-timeline-title">Histórico do processo</div>
              <PostTimelineList nodes={nodes} />
            </div>
          )}
        </>
      )}
    </section>
  );
}
